// The owner explicitly selected these seven repository names and links for the
// demo, including repositories they intend to publish later. Names and URLs
// were verified through GitHub; no repository contents or personal notes were
// imported. GitHub controls visitor access until the owner publishes each repo.
const projects=[
 ['demo-portfolio-lifeos','LifeOS Open','lifeos-open','active'],
 ['demo-portfolio-kitchen','Kitchen Renovation Modeling','Kitchen-Renovation-Modeling','completed'],
 ['demo-portfolio-structural-review','Structural Review Prototype','structural-review-prototype','completed'],
 ['demo-portfolio-distrofit','DistroFit','DistroFit','completed'],
 ['demo-portfolio-predictive-workload','Predictive Workload Management System','predictive-workload-management-system','completed'],
 ['demo-portfolio-computer-vision','Computer Vision Layout Stamping System','computer-vision-layout-stamping-system','completed'],
 ['demo-portfolio-multimodal-drawing','Multimodal Drawing Review System','multimodal-drawing-review-system','completed']
];

export function publicProjectRecords(){
 return projects.map(([id,title,repository,status])=>({id,data:{title,category:'personal-project',notes:'',nextStep:'',status,archived:false,githubUrl:'https://github.com/jackaI1/'+repository}}));
}
