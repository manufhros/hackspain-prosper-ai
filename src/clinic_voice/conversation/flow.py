import inspect
import json

from pipecat.flows import FlowManager, FlowsFunctionSchema, NodeConfig
from pydantic import ConfigDict, create_model

from clinic_voice.application.tools import TOOL_NAMES, ClinicTools
from clinic_voice.conversation.prompts import STAGES, SYSTEM

DESCRIPTIONS = {
    "clinic_catalog": "Read authoritative providers, locations, languages, opening hours, insurance restrictions and calendar.",
    "search_directory": "Search the PATIENT by name plus a caller-supplied DNI/NIE, phone or ISO birth date. Verifies a unique match; never use caller ID as proof.",
    "search_availability": "Find real slots for the verified patient. Dates YYYY-MM-DD; 14 days max; tomorrow onwards. time_of_day=any/morning/afternoon; weekday Monday=0. provider_language is an ISO language code only when requested. policy_id is a plan actually held by the caller.",
    "list_appointments": "Read the verified patient's diary, when=upcoming/past/all. Only upcoming IDs can be cancelled/moved.",
    "prepare_action": "Prepare book/cancel/reschedule/register, then speak details and WAIT for caller confirmation. Book uses offer_ref; cancel uses appointment_id; reschedule uses both. register requires registration object with given_name, first_surname, second_surname, national_id, date_of_birth, phone, email, insurer.",
    "commit_action": "Submit the prepared proposal AFTER it has been spoken and caller confirms on a NEW turn. Supply proposal_id and exact confirmation_quote from latest caller message. Never call on a correction or mere assumption.",
    "report_outcome": "Submit no-action or escalate with a closed-vocabulary reason from restrictions or medical_emergency, out_of_scope, no_availability, clinic_closed, patient_not_found, provider_not_found, caller_not_authorised.",
    "revise_request": "Invalidate pending proposal and offers after a correction or preference change. Then search/prepare again.",
    "nearest_sites": "Geocode caller's street address and return clinic sites ordered by straight-line distance. Check availability in that order; never guess geography.",
}


def schema_for(method):
    fields = {}
    for name, param in inspect.signature(method).parameters.items():
        fields[name] = (
            param.annotation,
            ... if param.default is inspect.Parameter.empty else param.default,
        )
    model = create_model(f"{method.__name__}Args", __config__=ConfigDict(extra="forbid"), **fields)
    return model, model.model_json_schema()


class ClinicFlow:
    def __init__(self, tools: ClinicTools, profile_callback):
        self.tools = tools
        self.profile_callback = profile_callback

    def node(self, stage: str) -> NodeConfig:
        functions = []
        names = TOOL_NAMES - {"commit_action"}
        if stage == "confirmation":
            names = names | {"commit_action"}
        for name in sorted(names):
            method = getattr(self.tools, name)
            model, schema = schema_for(method)

            def bind(tool_name, args_model):
                async def handler(args, manager: FlowManager):
                    try:
                        validated = args_model.model_validate(args).model_dump()
                    except Exception as exc:
                        return {"ok": False, "error": str(exc)}, None
                    before = self.tools.state.stage
                    result = await self.tools.invoke(tool_name, validated)
                    after = self.tools.state.stage
                    if before != after:
                        await self.tools.events.emit(
                            self.tools.state.call_id, "flow.changed", previous=before, stage=after
                        )
                        return result, self.node(after)
                    return result, None

                return handler

            functions.append(
                FlowsFunctionSchema(
                    name=name,
                    description=DESCRIPTIONS[name],
                    properties=schema.get("properties", {}),
                    required=schema.get("required", []),
                    handler=bind(name, model),
                    cancel_on_interruption=False,
                    timeout_secs=25,
                )
            )

        async def profile(args, manager):
            value = args["profile"]
            if value not in {"conversation", "dictation", "waiting"}:
                return {"ok": False, "error": "Invalid profile"}, None
            await self.profile_callback(value)
            return {"ok": True, "profile": value}, None

        async def finish(args, manager):
            if not self.tools.state.actions:
                return {"ok": False, "error": "Submit an appropriate outcome first"}, None
            return {"ok": True}, NodeConfig(
                name="end",
                task_messages=[
                    {
                        "role": "developer",
                        "content": "Say a brief goodbye in the caller's language.",
                    }
                ],
                post_actions=[{"type": "end_conversation"}],
            )

        functions += [
            FlowsFunctionSchema(
                name="set_listening_profile",
                description="Adjust pauses: dictation for numbers/email; waiting for explicit wait; conversation otherwise.",
                properties={
                    "profile": {"type": "string", "enum": ["conversation", "dictation", "waiting"]}
                },
                required=["profile"],
                handler=profile,
            ),
            FlowsFunctionSchema(
                name="end_call",
                description="End only when caller is finished and all outcomes were submitted.",
                properties={},
                required=[],
                handler=finish,
            ),
        ]
        context = {
            "today": str(self.tools.state.today),
            "verified_patient_id": self.tools.state.patient_id,
            "proposal": self.tools.state.proposal.model_dump()
            if self.tools.state.proposal
            else None,
        }
        return NodeConfig(
            name=stage,
            role_message=SYSTEM,
            functions=functions,
            task_messages=[
                {
                    "role": "developer",
                    "content": STAGES.get(stage, STAGES["request"])
                    + "\nCurrent verified state: "
                    + json.dumps(context),
                }
            ],
        )
