import asyncio
import time

import httpx


class Geocoder:
    """Cached, serialized geocoding. No model-generated coordinates."""

    def __init__(self, url: str):
        self.url = url
        self.cache = {}
        self.lock = asyncio.Lock()
        self.last_request = 0.0

    async def lookup(self, address: str):
        async with self.lock:
            if address in self.cache:
                return self.cache[address]
            await asyncio.sleep(max(0, 1 - (time.monotonic() - self.last_request)))
            async with httpx.AsyncClient(
                timeout=5, headers={"User-Agent": "ArenalVoice/0.1"}
            ) as http:
                self.last_request = time.monotonic()
                response = await http.get(
                    self.url, params={"q": address, "limit": 3, "lat": 40.4168, "lon": -3.7038}
                )
                response.raise_for_status()
                features = response.json().get("features", [])
                # Reject coordinates outside Madrid's broad region rather than a remote namesake.
                candidates = [
                    f["geometry"]["coordinates"]
                    for f in features
                    if -4.5 < f["geometry"]["coordinates"][0] < -2.5
                    and 39.5 < f["geometry"]["coordinates"][1] < 41.5
                ]
                result = candidates[0] if len(candidates) == 1 else None
                self.cache[address] = result
                return result
