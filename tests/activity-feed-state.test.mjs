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
 const event={type:'codex',method:'item/completed',threadId:'demo-A',params:{item:{id:'demo-5',type:'fileChange',changes:[{path:'C:/Users/SECRET/.env'}]},prompt:'private'}};
 const value=activityFromCodex(event);
 assert.deepEqual(value,{threadId:'demo-A',kind:'files',key:'files:demo-5'});
 const t=new ActivityTimeline();t.record(value,1);
 assert.equal(JSON.stringify(t.entries).includes('SECRET'),false);
});
test('token stream never creates activity, command bursts merge',()=>{
 assert.equal(activityFromCodex({type:'codex',method:'item/agentMessage/delta',threadId:'demo-A',params:{delta:'secret'}}),null);
 const t=new ActivityTimeline();
 t.record({threadId:'demo-A',kind:'command',key:'command:demo-1'},1);
 t.record({threadId:'demo-A',kind:'command',key:'command:demo-2'},2);
 assert.equal(t.entries.length,1);
});
