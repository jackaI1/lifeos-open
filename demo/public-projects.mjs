// Authored fictional portfolio projects. Links are configurable examples.
const projects=[
 ['demo-portfolio-lifeos','LifeOS Open','lifeos-open','active'],
 ['demo-portfolio-kitchen','Community Garden Planner','community-garden-planner','completed'],
 ['demo-portfolio-structural-review','Library Catalogue','library-catalogue','completed'],
 ['demo-portfolio-habits','Habit Tracker','habit-tracker','completed'],
 ['demo-portfolio-predictive-workload','Reading Queue','reading-queue','completed'],
 ['demo-portfolio-computer-vision','Weather Dashboard','weather-dashboard','completed'],
 ['demo-portfolio-multimodal-drawing','Sketchbook','sketchbook','completed']
];

export function publicProjectRecords(){
 return projects.map(([id,title,repository,status])=>({id,data:{title,category:'personal-project',notes:'',nextStep:'',status,archived:false,githubUrl:'https://github.com/example/'+repository}}));
}
