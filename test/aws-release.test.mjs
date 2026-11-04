import assert from 'node:assert/strict';
import test from 'node:test';
import {releaseImage} from '../tools/deploy-aws.mjs';

const cluster = 'lifeos-open-demo', service = 'lifeos-open-demo';
const repository = '123456789012.dkr.ecr.us-east-1.amazonaws.com/lifeos-open-demo';
const imageTag = 'aws-0123456789abcdef0123456789abcdef01234567';
const oldArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/lifeos-open-demo:1';
const newArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/lifeos-open-demo:2';
const template = {
 family:service,networkMode:'awsvpc',cpu:'256',memory:'512',requiresCompatibilities:['FARGATE'],
 executionRoleArn:'arn:aws:iam::123456789012:role/demo-task-execution',
 containerDefinitions:[{name:'demo',image:repository+':old',readonlyRootFilesystem:true,portMappings:[{containerPort:8080}],environment:[{name:'PARENT_ORIGIN',value:'https://portfolio.example.invalid'}]}],
 taskDefinitionArn:oldArn,revision:1,status:'ACTIVE',registeredAt:'2026-01-01T00:00:00Z'
};
const snapshot = (arn, state='COMPLETED') => ({services:[{
 taskDefinition:arn,desiredCount:1,runningCount:1,deployments:[{status:'PRIMARY',taskDefinition:arn,rolloutState:state}]
}],failures:[]});

test('AWS release preserves task configuration and waits for the new ECS revision', async () => {
 let polls=0,registered,updated;
 const aws=async args => {
  if(args[1]==='describe-services') return snapshot(polls++<2?oldArn:newArn);
  if(args[1]==='describe-task-definition') return {taskDefinition:structuredClone(template)};
  if(args[1]==='register-task-definition') {registered=JSON.parse(args[args.indexOf('--cli-input-json')+1]);return {taskDefinition:{taskDefinitionArn:newArn}};}
  if(args[1]==='update-service') {updated=args[args.indexOf('--task-definition')+1];return {};}
  throw Error('Unexpected AWS action '+args[1]);
 };
 assert.equal(await releaseImage({cluster,service,repository,imageTag,aws,pause:async()=>{}}),newArn);
 assert.equal(polls,3,'The old steady service must not count as a successful new release');
 assert.equal(updated,newArn);
 assert.equal(registered.containerDefinitions[0].image,repository+':'+imageTag);
 assert.deepEqual(registered.containerDefinitions[0].environment,template.containerDefinitions[0].environment);
 assert.equal(registered.executionRoleArn,template.executionRoleArn);
 assert.equal(registered.containerDefinitions[0].readonlyRootFilesystem,true);
 assert.equal(registered.revision,undefined);
 assert.equal(registered.taskDefinitionArn,undefined);
});

test('AWS release reports circuit breaker failure instead of declaring success', async () => {
 let reads=0;
 const aws=async args => {
  if(args[1]==='describe-services') return reads++===0?snapshot(oldArn):snapshot(newArn,'FAILED');
  if(args[1]==='describe-task-definition') return {taskDefinition:structuredClone(template)};
  if(args[1]==='register-task-definition') return {taskDefinition:{taskDefinitionArn:newArn}};
  return {};
 };
 await assert.rejects(releaseImage({cluster,service,repository,imageTag,aws,pause:async()=>{}}),/FAILED/);
});

test('AWS release has a bounded wait if the selected revision never becomes healthy', async () => {
 const aws=async args => {
  if(args[1]==='describe-services') return snapshot(oldArn);
  if(args[1]==='describe-task-definition') return {taskDefinition:structuredClone(template)};
  if(args[1]==='register-task-definition') return {taskDefinition:{taskDefinitionArn:newArn}};
  return {};
 };
 await assert.rejects(releaseImage({cluster,service,repository,imageTag,aws,pause:async()=>{},attempts:2}),/timed out/);
});

test('AWS release rejects mutable image references before AWS calls', async () => {
 const aws=async()=>assert.fail('Invalid references must not reach AWS');
 await assert.rejects(releaseImage({cluster,service,repository,imageTag:'latest',aws}),/image/);
});
