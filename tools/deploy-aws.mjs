import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const execute = promisify(execFile);
async function awsCLI(args) {
 const {stdout} = await execute('aws', [...args,'--output','json'], {
  env:{...process.env,AWS_PAGER:''},maxBuffer:1024*1024,timeout:60_000
 });
 return JSON.parse(stdout);
}

/** Clone the active task, replace only its image, and verify the new rollout. */
export async function releaseImage({cluster,service,repository,imageTag,aws=awsCLI,pause=ms=>new Promise(r=>setTimeout(r,ms)),attempts=90}) {
 if (!/^[a-z][a-z0-9-]{3,30}$/.test(cluster ?? '') || !/^[a-z][a-z0-9-]{3,30}$/.test(service ?? '') ||
  !/^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/[a-z0-9-]+$/.test(repository ?? '') ||
  !/^aws-[a-f0-9]{40}$/.test(imageTag ?? '')) throw Error('Invalid AWS service or immutable image reference');
 const describe = async () => {
  const result = await aws(['ecs','describe-services','--cluster',cluster,'--services',service]);
  if (result.failures?.length || result.services?.length!==1) throw Error('ECS service is unavailable');
  return result.services[0];
 };
 const active = await describe();
 const {taskDefinition:template} = await aws(['ecs','describe-task-definition','--task-definition',active.taskDefinition]);
 // Omit read-only response properties when registering the next task revision.
 const allowed = ['family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes','placementConstraints','requiresCompatibilities','cpu','memory','pidMode','ipcMode','proxyConfiguration','inferenceAccelerators','ephemeralStorage','runtimePlatform'];
 const definition = Object.fromEntries(allowed.filter(key=>template[key]!==undefined).map(key=>[key,template[key]]));
 const container = definition.containerDefinitions.find(item=>item.name==='demo');
 if (!container || definition.family!==service) throw Error('Expected the Terraform-managed demo task');
 container.image = `${repository}:${imageTag}`;
 const {taskDefinition:registered} = await aws(['ecs','register-task-definition','--cli-input-json',JSON.stringify(definition)]);
 const revision = registered?.taskDefinitionArn;
 if (!revision) throw Error('AWS did not return a task definition ARN');
 await aws(['ecs','update-service','--cluster',cluster,'--service',service,'--task-definition',revision]);
 let seenRevision = false;
 for (let attempt=0; attempt<attempts; attempt++) {
  const current = await describe();
  const deployment = current.deployments?.find(item=>item.taskDefinition===revision);
  if (deployment) seenRevision = true;
  if (deployment?.rolloutState==='FAILED') throw Error('ECS deployment FAILED; inspect service events');
  if (seenRevision && current.deployments?.find(item=>item.status==='PRIMARY')?.taskDefinition!==revision) throw Error('ECS deployment rolled back; inspect service events');
  if (deployment?.status==='PRIMARY' && deployment.rolloutState==='COMPLETED' &&
   current.taskDefinition===revision && current.runningCount===current.desiredCount) return revision;
  await pause(10_000);
 }
 throw Error('ECS deployment timed out; inspect rollout before retrying');
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const revision = await releaseImage({cluster:process.env.AWS_ECS_CLUSTER,service:process.env.AWS_ECS_SERVICE,repository:process.env.ECR_REPOSITORY_URL,imageTag:process.env.IMAGE_TAG});
 console.log(revision);
}
