/** Paid LLM replay of the failed concurrent calls. Synthetic clinic; no Prosper writes. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import * as openai from "@livekit/agents-plugin-openai";
import { LiveKitEngine } from "../packages/adapters/src/livekit.js";
import { ConversationalTTS } from "../packages/adapters/src/livekit-tts.js";
import { FixtureClinic, MemorySink } from "../packages/adapters/src/clinic.js";
import { MemoryRepository } from "../packages/adapters/src/storage.js";
import { CallRuntime } from "../packages/runtime/src/session.js";
import { DeliveryService } from "../packages/runtime/src/delivery.js";
import { TELEPHONE_AUDIO, type BookingRequest, type DomainEvent } from "../packages/contracts/src/index.js";
class ReplayClinic extends FixtureClinic {
  async catalog() {return {...await super.catalog(),specialties:[{id:"general_practice",name:"General Practice"},{id:"orthopaedics",name:"Orthopaedics"}]};}
  async availability(request:BookingRequest & {patient_id:string}) {
    if (!['general_practice','orthopaedics'].includes(request.specialty_id??'')) throw Error('Invalid specialty');
    const result=await super.availability(request);
    return {...result,slots:result.slots.map(s=>({...s,specialty_id:request.specialty_id!}))};
  }
}
const scenarios=[
  {specialty:'General Practice',confirmation:"Ah, yes, that's fine. Please book it."},
  {specialty:'orthopedics',confirmation:'Yes, please go ahead.'},
  {specialty:'orthopaedics',confirmation:'Mm, yes, I confirm.'},
  {specialty:'orthopedics',confirmation:'Yes, please.'},
  {specialty:'General Practice',confirmation:'Yes, I confirm.'},
];
const results=await Promise.all(scenarios.map(async(s,index)=>{
  const clinic=new ReplayClinic(),repository=new MemoryRepository(),sink=new MemorySink(),events:DomainEvent[]=[];
  const engine=new LiveKitEngine({openaiKey:'',model:'replay',elevenlabsKey:'',voiceId:''},{
    llm:new openai.LLM({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_TEXT_MODEL||'gpt-4.1-mini',parallelToolCalls:false,strictToolSchema:false,maxCompletionTokens:1000}),
    tts:new ConversationalTTS({async *synthesize(){yield {data:new Uint8Array(160).fill(255),format:TELEPHONE_AUDIO};}}),
  });
  const call=new CallRuntime(engine,clinic,repository,new DeliveryService(repository,sink),'replay-'+randomUUID(),new Date(),e=>events.push(e));
  let failure:string|undefined;
  try {
    await call.start();
    await call.text(`I need the soonest ${s.specialty} appointment, any site, any time. My national ID is 12345678Z and my date of birth is March 14, 1988. My insurance is Sanitas. Please find the earliest slot and ask me to confirm it.`);
    for(let i=0;i<400 && !events.some(e=>e.type==='proposal.presented');i++)await new Promise(r=>setTimeout(r,25));
    if(!events.some(e=>e.type==='proposal.presented'))throw Error('Proposal not presented');
    await call.text(s.confirmation);
  } catch(error){failure=String(error);} finally{await call.close();}
  const actions=call.session.finalActions();
  return {case:index+1,specialty:s.specialty,confirmation:s.confirmation,passed:!failure&&actions.length===1&&actions[0]?.action.action==='BOOK',submittedToProsper:false,actions:actions.map(a=>a.action.action),toolErrors:events.filter(e=>e.type==='tool.failed').map(e=>e.data),failure};
}));
await mkdir('.data',{recursive:true});await writeFile('.data/run-regressions-evaluation.json',JSON.stringify({at:new Date().toISOString(),mode:'real LLM and LiveKit, synthetic clinic and audio',results},null,2));
console.log(JSON.stringify(results,null,2));
process.exitCode=results.every(r=>r.passed)?0:1;
