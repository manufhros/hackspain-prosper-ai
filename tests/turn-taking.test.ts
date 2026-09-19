import {it,expect} from 'vitest';
import {CommittedTurnDetector,PipelineEngine} from '../packages/conversation/src/engines.js';
import type {Transcript,EngineHost} from '../packages/contracts/src/index.js';
it('interrupts once per utterance and ignores a replay after commitment',()=>{
 const detector=new CommittedTurnDetector();let interruptions=0;const turns:string[]=[];const send=(text:string,final=false)=>detector.observe({text,final},t=>turns.push(t),()=>interruptions++);
 send('Hola');send('Hola');send('Hola buenos días');send('Hola buenos días',true);send('Hola buenos días.');send('Hola buenos días.');expect(interruptions).toBe(1);expect(turns).toEqual(['Hola buenos días']);send('Quiero cambiar');send('Quiero cambiar la cita');expect(interruptions).toBe(2);
});
it('finishes the model response when STT repeats the committed partial during silence',async()=>{
 let transcript!:(t:Transcript)=>void;const answers:string[]=[];let cancelled=false;
 const engine=new PipelineEngine({complete:async(_messages,_tools,signal)=>{await new Promise(r=>setTimeout(r,20));cancelled=signal.aborted;return {text:'¿Para qué día necesitas la cita?',calls:[]};}}, {start:async callback=>{transcript=callback;},write:()=>{},close:async()=>{}});
 const host:EngineHost={userText:()=>{},assistantText:t=>answers.push(t),audio:async()=>{},interrupt:()=>{},tool:async()=>({ok:true}),context:()=>'{}',event:()=>{}};
 await engine.start(host,[]);transcript({text:'Quiero una cita',final:false});transcript({text:'Quiero una cita',final:true});
 for(let i=0;i<5;i++)transcript({text:'Quiero una cita.',final:false});
 await new Promise(r=>setTimeout(r,40));expect(cancelled).toBe(false);expect(answers).toEqual(['¿Para qué día necesitas la cita?']);await engine.close();
});

it('retains detected language through tools without treating metadata as another user turn',async()=>{
 let transcript!:(t:Transcript)=>void;let calls=0;const prompts:string[]=[];const users:string[]=[];
 const engine=new PipelineEngine({complete:async(messages)=>{prompts.push(messages[0]!.content);if(++calls===1){await new Promise(r=>setTimeout(r,10));return {text:'',calls:[{id:'c',type:'function' as const,function:{name:'clinic_catalog',arguments:'{}'}}]};}return {text:'How can I help?',calls:[]};}}, {start:async cb=>{transcript=cb;},write:()=>{},close:async()=>{}});
 await engine.start({userText:t=>users.push(t),assistantText:()=>{},audio:async()=>{},interrupt:()=>{},tool:async()=>({ok:true,data:'Clínica: medicina general'}),context:()=>'{}',event:()=>{}},[]);
 transcript({text:'I need an appointment',final:true});transcript({text:'I need an appointment',final:true,language:'en',metadataOnly:true});
 await new Promise(r=>setTimeout(r,30));expect(users).toEqual(['I need an appointment']);expect(prompts[1]).toContain('Speech recognition suggests en');expect(prompts[1]).toContain('NEVER select the language');await engine.close();
});
