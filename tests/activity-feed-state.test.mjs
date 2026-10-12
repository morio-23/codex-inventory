import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityTimeline,activityFromCodex} from '../public/activity-feed-state.js';
test('simultaneous other-thread events remain separate and active thread is hidden',()=>{
 const timeline=new ActivityTimeline();
 timeline.record({threadId:'demo-B',kind:'completed',key:'finish:demo-1'},1000);
 timeline.record({threadId:'demo-C',kind:'approval',key:'approval:demo-2',persistent:true},1000);
 assert.deepEqual(timeline.visible({activeThreadIds:['demo-A'],now:2000}).map(x=>x.threadId),['demo-B','demo-C']);
 assert.deepEqual(timeline.visible({activeThreadIds:['demo-B'],now:2000}).map(x=>x.threadId),['demo-C']);
});
test('deduplicates replay, fades transient, keeps and resolves approval',()=>{
 const timeline=new ActivityTimeline();
 const done={threadId:'demo-A',kind:'completed',key:'finish:demo-3'};
 assert.equal(timeline.record(done,0),true);
 assert.equal(timeline.record(done,1),false);
 timeline.record({threadId:'demo-B',kind:'approval',key:'approval:demo-4',persistent:true},0);
 assert.equal(timeline.visible({now:9000}).length,1);
 timeline.record({threadId:'demo-B',kind:'approval-resolved',key:'approval:demo-4'},9001);
 assert.equal(timeline.visible({now:9002}).length,0);
});
test('only safe event metadata is retained',()=>{
 const event={type:'codex',method:'item/completed',threadId:'demo-A',params:{item:{id:'demo-5',type:'fileChange',changes:[{path:'/synthetic/only-for-tests/secret.txt'}]},prompt:'private'}};
 const value=activityFromCodex(event);
 assert.deepEqual(value,{threadId:'demo-A',kind:'files',key:'files:demo-A:demo-5'});
 const t=new ActivityTimeline();t.record(value,1);
 assert.equal(JSON.stringify(t.entries).includes('/synthetic/'),false);
});
test('token stream never creates activity, command bursts merge',()=>{
 assert.equal(activityFromCodex({type:'codex',method:'item/agentMessage/delta',threadId:'demo-A',params:{delta:'secret'}}),null);
 const t=new ActivityTimeline();
 t.record({threadId:'demo-A',kind:'command',key:'command:demo-1'},1);
 t.record({threadId:'demo-A',kind:'command',key:'command:demo-2'},2);
 assert.equal(t.entries.length,1);
 assert.equal(t.record({threadId:'demo-A',kind:'command',key:'command:demo-2'},3000),false);
});

test('resolved approval stays resolved when its request is replayed',()=>{
 const t=new ActivityTimeline();
 const request={threadId:'demo-B',kind:'approval',key:'approval:demo-8',persistent:true};
 t.record(request,1);
 t.record({threadId:'demo-B',kind:'approval-resolved',key:request.key},2);
 assert.equal(t.record(request,3),false);
 assert.deepEqual(t.entries,[]);
});

test('a reused approval number belongs to its original thread and turn',()=>{
 const t=new ActivityTimeline();
 const request=turnId=>activityFromCodex({type:'approval-request',approval:{
   approvalId:'1',threadId:'demo-A',turnId
 }});
 const resolved=activityFromCodex({type:'approval-resolved',
   approvalId:'1',threadId:'demo-A',turnId:'turn-1'});
 t.record(request('turn-1'),1);
 t.record(resolved,2);
 assert.equal(t.record(request('turn-1'),3),false);
 assert.equal(t.record(request('turn-2'),4),true);
 assert.deepEqual(t.entries.map(entry=>entry.kind),['approval']);
});

test('approval reset and reconnect clear only targeted persistent messages',()=>{
 const t=new ActivityTimeline();
 t.record({threadId:'demo-A',kind:'approval',key:'approval:demo-6',persistent:true},1);
 t.record({threadId:'',kind:'disconnected',key:'connection',persistent:true},2);
 t.record({threadId:'demo-B',kind:'completed',key:'finish:demo-7'},2);
 t.clearApprovals();
 assert.deepEqual(t.entries.map(x=>x.kind),['disconnected','completed']);
 assert.equal(t.record({threadId:'demo-C',kind:'approval',key:'approval:demo-6',persistent:true},3),true);
 assert.deepEqual(t.entries.map(x=>x.kind),['disconnected','completed','approval']);
 t.clearConnection();
 assert.deepEqual(t.entries.map(x=>x.kind),['completed','approval']);
 assert.equal(t.record({threadId:'',kind:'disconnected',key:'connection',persistent:true},3),true);
 assert.deepEqual(t.entries.map(x=>x.kind),['completed','approval','disconnected']);
});
