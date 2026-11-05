import { expect, test } from 'bun:test';
import { buildReport } from '../src/core/report';
import { extractDocument } from '../src/core/extract';
import { extractBatches } from '../src/core/batching';

test('validates written counts without changing the source quote or sign', () => {
 const text='There were sixty-three volunteers; Nine were excluded and three declined.';
 const items=['63','9','3'].map(value=>({field:'count',value,quote:text,page:1,visual:false}));
 expect(buildReport([{number:1,text}],items).items.map(x=>x.evidenceStatus)).toEqual(['source_located','source_located','source_located']);
 expect(buildReport([{number:1,text:'minus nine'}],[{...items[0],value:'9',quote:'minus nine'}]).items[0].evidenceStatus).toBe('needs_review');
 expect(buildReport([{number:1,text:'one hundred and nine'}],[{...items[0],value:'9',quote:'one hundred and nine'}]).items[0].evidenceStatus).toBe('needs_review');
 expect(buildReport([{number:1,text:'one hundred'}],[{...items[0],value:'1',quote:'one hundred'}]).items[0].evidenceStatus).toBe('needs_review');
});

test('suppresses an abbreviated running author when the instruction excludes headers',async()=>{
 const r=await extractDocument({mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number:1,sourceNumber:13,text:'Results. D. Ariansyah et al.'}]},'Extract authors and exclude running headers',async()=>[{field:'Authors',value:'D. Ariansyah et al.',page:1,quote:'D. Ariansyah et al.',visual:false}]);
 expect(r.items).toHaveLength(0);
});

test('audits an empty conclusion page once',async()=>{
 let calls=0;
 const r=await extractBatches([{mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number:17,text:'Conclusion and further research. Transferability is uncertain.'}]}],'Extract research questions and stated limitations',async input=>{
  calls++;
  return input.reviewCoverage?[{field:'Limitation',value:'Transferability is uncertain.',page:1,quote:'Transferability is uncertain.',visual:false}]:[];
 });
 expect(calls).toBe(2);
 expect(r.items[0].value).toBe('Transferability is uncertain.');
});

test('combines matching percentage paraphrases with both source references',async()=>{
 const entries=[
  {field:'Key result: 3D animation vs. video instructions in task completion time',factKey:'result_task_time',value:'14% improvement with 3D animation',quote:'3D animation led to a 14% improvement over video instructions.'},
  {field:'Task completion time: 3D animation-based instruction vs. video-based visualisation (information mode)',factKey:'time_animation',value:'significantly faster completion time (14%)',quote:'3D animation showed significantly faster completion time (14%) compared to video.'},
 ];
 const batches=entries.map((e,i)=>({mimeType:'application/pdf',bytes:new Uint8Array([i]),pages:[{number:i+1,text:e.quote}]}));
 const r=await extractBatches(batches,'Extract research results',async input=>[{...entries[input.bytes[0]],page:1,visual:false}]);
 expect(r.items).toHaveLength(1);
 expect(r.items[0].citations).toHaveLength(2);
});

test('flags a condition code inconsistent with its row quotation',()=>{
 const r=buildReport([{number:1,text:'CG 10 M = 7'}],[{field:'Participants - GG condition N',value:'10',page:1,quote:'CG 10 M = 7',visual:true}]);
 expect(r.items[0].reasonCode).toBe('CONTEXT_NOT_SUPPORTED');
});

test('keeps opposite percentage conclusions separate',async()=>{
 const entries=[
  {field:'Completion time: animation vs video',value:'14% improvement',quote:'Animation yielded a 14% improvement.'},
  {field:'Completion time: animation vs video',value:'14% increase',quote:'Animation yielded a 14% increase.'},
 ];
 const r=await extractBatches(entries.map((e,i)=>({mimeType:'application/pdf',bytes:new Uint8Array([i]),pages:[{number:i+1,text:e.quote}]})),'Extract',async input=>[{...entries[input.bytes[0]],page:1,visual:false}]);
 expect(r.items).toHaveLength(2);
});
