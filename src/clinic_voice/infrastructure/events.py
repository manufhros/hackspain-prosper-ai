"""One durable, ordered event stream for logs, diagnosis and the live console."""

import asyncio
import json
import logging
import re
import traceback
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import aiosqlite

SECRET_KEYS = {"authorization", "x-api-key", "api_key", "token", "password", "secret"}
PRIVATE_KEYS = {"national_id", "phone", "from_number", "email", "date_of_birth"}


def scrub(value: Any, key: str = "", secrets: tuple[str, ...] = ()) -> Any:
    if key.lower() in PRIVATE_KEYS | SECRET_KEYS or key.lower().endswith(("_api_key", "_token")):
        return "[redacted]"
    if isinstance(value, dict):
        return {k: scrub(v, k, secrets) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v, secrets=secrets) for v in value]
    if isinstance(value, str):
        for secret in secrets:
            value = value.replace(secret, "[secret]")
        value = re.sub(r"(?i)bearer\s+\S+|\b(?:sk|pk|xi)-[\w-]+", "[secret]", value)
        value = re.sub(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", "[email]", value)
        value = re.sub(
            r"(?i)\b[XYZ]?\d[\d\s-]{5,}\d[A-Z]?\b",
            lambda m: m[0] if re.fullmatch(r"\d{4}-\d{2}-\d{2}T?", m[0]) else "[identifier]",
            value,
        )
        return value[:12000]
    return value


class EventStore:
    def __init__(self, directory: Path, secrets=()):
        self.directory = directory
        self.secrets = tuple(s for s in secrets if len(s) >= 6)
        self.lock = asyncio.Lock()
        self.db: aiosqlite.Connection | None = None
        self.logger = logging.getLogger(f"clinic.events.{id(self)}")
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False

    async def open(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = await aiosqlite.connect(self.directory / "events.sqlite3")
        self.db.row_factory = aiosqlite.Row
        await self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
                call_id TEXT NOT NULL, kind TEXT NOT NULL, level TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_call ON events(call_id,id);
            CREATE TABLE IF NOT EXISTS calls (
                call_id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
                ended_at TEXT, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}'
            );
        """)
        # A previous process cannot still own these calls (single worker deployment).
        await self.db.execute(
            "UPDATE calls SET status='interrupted', ended_at=? WHERE ended_at IS NULL",
            (datetime.now(UTC).isoformat(),),
        )
        await self.db.commit()
        handler = RotatingFileHandler(
            self.directory / "events.jsonl", maxBytes=10_000_000, backupCount=5
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.logger.addHandler(handler)

    async def emit(self, call_id: str, kind: str, level: str = "info", **data):
        assert self.db
        event = dict(
            ts=datetime.now(UTC).isoformat(),
            call_id=call_id,
            kind=kind,
            level=level,
            data=scrub(data, secrets=self.secrets),
        )
        async with self.lock:
            if kind == "call.started":
                async with self.db.execute(
                    "SELECT 1 FROM calls WHERE call_id=?", (call_id,)
                ) as existing:
                    if await existing.fetchone():
                        raise ValueError("callSid has already been used; refusing to replay a call")
            cursor = await self.db.execute(
                "INSERT INTO events(ts,call_id,kind,level,data) VALUES(?,?,?,?,?)",
                (event["ts"], call_id, kind, level, json.dumps(event["data"], ensure_ascii=False)),
            )
            event["id"] = cursor.lastrowid
            if kind == "call.started":
                await self.db.execute(
                    "INSERT INTO calls(call_id,started_at,status,detail) VALUES(?,?,'active',?)",
                    (call_id, event["ts"], json.dumps(event["data"])),
                )
            elif kind == "call.ended":
                await self.db.execute(
                    "UPDATE calls SET ended_at=?,status=?,detail=? WHERE call_id=?",
                    (event["ts"], data.get("status", "ended"), json.dumps(event["data"]), call_id),
                )
            await self.db.commit()
        self.logger.info(json.dumps(event, ensure_ascii=False))
        return event

    async def failure(self, call_id: str, kind: str, exc: BaseException, **data):
        return await self.emit(
            call_id,
            kind,
            "error",
            error_type=type(exc).__name__,
            message=str(exc),
            stack="".join(traceback.format_exception(exc)),
            **data,
        )

    async def calls(self):
        assert self.db
        async with self.db.execute("""SELECT c.*,
            (SELECT COUNT(*) FROM events e WHERE e.call_id=c.call_id AND e.level='error') AS errors,
            (SELECT COUNT(*) FROM events e WHERE e.call_id=c.call_id AND e.kind='operation.accepted') AS actions
            FROM calls c ORDER BY started_at DESC LIMIT 200""") as cur:
            return [
                dict(row) | {"detail": json.loads(row["detail"])} for row in await cur.fetchall()
            ]

    async def events(self, after: int = 0, call_id: str | None = None, limit: int = 300):
        assert self.db
        query = "SELECT * FROM events WHERE id>?"
        args: list = [after]
        if call_id:
            query += " AND call_id=?"
            args.append(call_id)
        query += " ORDER BY id LIMIT ?"
        args.append(min(limit, 1000))
        async with self.db.execute(query, args) as cur:
            return [dict(row) | {"data": json.loads(row["data"])} for row in await cur.fetchall()]

    async def close(self):
        if self.db:
            await self.db.close()
        for handler in self.logger.handlers[:]:
            handler.close()
            self.logger.removeHandler(handler)
