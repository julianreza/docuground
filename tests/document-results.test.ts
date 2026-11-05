import { expect, test } from 'bun:test';
import { extractDocument } from '../src/core/extract';
import { extractBatches } from '../src/core/batching';
import { TruncatedResponseError } from '../src/core/extract';

test('suppresses batch placeholders but preserves source-backed unavailable fields', async () => {
 const result = await extractDocument({mimeType:'image/jpeg',bytes:new Uint8Array(),pages:[{number:1,text:''}]},'Extract',async()=>[
 {field:'Title',value:null,valueState:'not_located',quote:'',visual:false,page:1},
 {field:'Empty',value:null,valueState:'blank',quote:'Label',visual:true,page:1},
 ]);
 expect(result.items).toHaveLength(1);
 expect(result.omittedBatchPlaceholders).toBe(1);
});

test('recovers a single page once with a larger budget', async () => {
 let count=0;
 const report=await extractBatches([{mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number:7,text:'Total 10'}]}],'Extract',async(input)=>{
  count++;
  if(count===1)throw new TruncatedResponseError();
  expect(input.maxOutputTokens).toBe(16384);
  return [{field:'Total',value:'10',quote:'Total 10',page:1,visual:false}];
 });
 expect(count).toBe(2);
 expect(report.processedPages).toEqual([7]);
 expect(report.status).toBe('complete');
});

test('merges only equal keyed facts and retains citations', async () => {
 const batches=[1,2].map(number=>({mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number,text:'Improvement 14%'}]}));
 const report=await extractBatches(batches,'Extract',async()=>[{field:'Improvement',factKey:'time-animation-video',value:'14%',quote:'Improvement 14%',page:1,visual:false}]);
 expect(report.items).toHaveLength(1);
 expect(report.items[0].citations?.map(c=>c.page)).toEqual([1,2]);
});

test('stops after two single-page failures and does not publish fragments', async () => {
 let attempts=0;
 const report=await extractBatches([{mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number:7,text:''}]}],'Extract',async()=>{attempts++;throw new TruncatedResponseError();});
 expect(attempts).toBe(2);
 expect(report.failedPages).toEqual([7]);
 expect(report.items).toHaveLength(0);
});

test('repairs an observed null before publishing a page', async () => {
 let attempts=0;
 const report=await extractBatches([{mimeType:'application/pdf',bytes:new Uint8Array(),pages:[{number:1,text:'No difference was found.'}]}],'Extract',async(input)=>{
  attempts++;
  return [{field:'result',value:input.repairValues?'No difference was found.':null,valueState:'observed',page:1,quote:'No difference was found.',visual:false}];
 });
 expect(attempts).toBe(2);
 expect(report.items[0].value).toBe('No difference was found.');
 expect(report.processedPages).toEqual([1]);
});
