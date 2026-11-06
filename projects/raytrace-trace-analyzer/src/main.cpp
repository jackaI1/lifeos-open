#include "geometry.hpp"
#include "png.hpp"
#include <chrono>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>

using namespace rt;
using Clock=std::chrono::steady_clock;
double milliseconds(Clock::time_point start,Clock::time_point end) {
    return std::chrono::duration<double,std::milli>(end-start).count();
}
struct Options { int width=640,height=360,frames=8; bool brute=false,shadows=true; std::filesystem::path output="runs/render"; };
int positive(const std::string& value,int maximum) {
    size_t used=0; int n=std::stoi(value,&used);
    if(used!=value.size()||n<1||n>maximum) throw std::runtime_error("numeric option out of range: "+value);
    return n;
}
Options parse(int argc,char** argv) {
    Options options;
    for(int i=1;i<argc;++i) {
        std::string key=argv[i];
        if(key=="--brute-force") options.brute=true;
        else if(key=="--no-shadows") options.shadows=false;
        else if(key=="--width"||key=="--height"||key=="--frames"||key=="--output") {
            if(++i>=argc) throw std::runtime_error("missing value for "+key);
            if(key=="--output") options.output=argv[i];
            else if(key=="--width") options.width=positive(argv[i],4096);
            else if(key=="--height") options.height=positive(argv[i],4096);
            else options.frames=positive(argv[i],120);
        } else throw std::runtime_error("unknown argument: "+key);
    }
    return options;
}
std::vector<Primitive> make_scene(int frame) {
    std::vector<Primitive> scene;
    Vec floor{.40,.46,.52};
    scene.push_back(Primitive::triangle({-20,0,10},{20,0,10},{20,0,-24},floor));
    scene.push_back(Primitive::triangle({-20,0,10},{20,0,-24},{-20,0,-24},floor));
    for(int z=0;z<11;++z) for(int x=-8;x<=8;++x) {
        double radius=.32+.06*((x+z+16)%3);
        Vec color{.18+.65*(x+8)/16.,.25+.45*z/10.,.65-.35*z/10.};
        scene.push_back(Primitive::sphere({x*1.15,radius,-z*1.15},radius,color));
    }
    scene.push_back(Primitive::sphere({1.8*std::sin(frame*.17),1.8+.3*std::sin(frame*.31),1},.9,{.92,.32,.12}));
    Vec top{-2,2.4,1},a{-3,0,2},b{-1,0,2},c{-2,0,-.2};
    scene.push_back(Primitive::triangle(a,b,top,{.16,.72,.63}));
    scene.push_back(Primitive::triangle(b,c,top,{.13,.58,.52}));
    scene.push_back(Primitive::triangle(c,a,top,{.2,.8,.7}));
    return scene;
}
std::vector<unsigned char> render(const std::vector<Primitive>& scene,const BVH* bvh,const Options& o,Counters& counts) {
    std::vector<unsigned char> pixels(static_cast<size_t>(o.width)*o.height*3);
    Vec eye{0,5.8,12}, forward=unit(Vec{0,.2,-4}-eye);
    Vec right=unit(cross(forward,{0,1,0})),up=cross(right,forward),light{-4,9,5};
    auto closest=[&](const Ray& ray,double far,Hit& h) {
        return bvh?bvh->closest(ray,.0001,far,h,counts):brute(scene,ray,.0001,far,h,counts);
    };
    for(int y=0;y<o.height;++y) for(int x=0;x<o.width;++x) {
        double u=(2*(x+.5)/o.width-1)*static_cast<double>(o.width)/o.height*.48;
        double v=(1-2*(y+.5)/o.height)*.48;
        Ray ray{eye,unit(forward+right*u+up*v)}; ++counts.primary_rays; Hit hit;
        Vec color{.075,.11,.17};
        if(closest(ray,INFINITY,hit)) {
            Vec point=ray.origin+ray.direction*hit.t, to_light=light-point;
            double distance=std::sqrt(dot(to_light,to_light)); Vec l=to_light*(1/distance);
            double diffuse=std::max(0.,dot(hit.normal,l)); bool blocked=false;
            if(o.shadows&&diffuse>0) {
                ++counts.shadow_rays; Hit blocker;
                blocked=closest({point+hit.normal*.0002,l},distance-.0004,blocker);
            }
            color=scene[hit.id].color*.12;
            if(!blocked) {
                Vec reflected=hit.normal*(2*dot(hit.normal,l))-l;
                double specular=std::pow(std::max(0.,dot(reflected,ray.direction*(-1))),48)*.45;
                color=color+scene[hit.id].color*(diffuse*.85)+Vec{1,1,1}*specular;
            }
        }
        size_t index=(static_cast<size_t>(y)*o.width+x)*3;
        for(int c=0;c<3;++c) pixels[index+c]=static_cast<unsigned char>(255*std::sqrt(std::clamp(color[c],0.,1.))+.5);
    }
    return pixels;
}
int main(int argc,char** argv) {
    if(argc==2&&std::string(argv[1])=="--help") {
        std::cout<<"raytrace [--output NEW_DIRECTORY] [--width 1..4096] [--height 1..4096] [--frames 1..120]\n"
                   "         [--brute-force] [--no-shadows]\n"; return 0;
    }
    try {
        Options o=parse(argc,argv);
        if(std::filesystem::exists(o.output)) throw std::runtime_error("output already exists; choose a new directory");
        if(!o.output.parent_path().empty()) std::filesystem::create_directories(o.output.parent_path());
        if(!std::filesystem::create_directory(o.output)) throw std::runtime_error("could not create output directory");
        std::ofstream trace(o.output/"trace.json"); trace.exceptions(std::ios::failbit|std::ios::badbit);
        trace<<std::fixed<<std::setprecision(6)<<"{\n  \"schema_version\": 1,\n  \"scene\": \"sphere-grid-v1/"
             <<(o.shadows?"shadows":"no-shadows")<<"\",\n  \"width\": "<<o.width<<", \"height\": "<<o.height
             <<",\n  \"mode\": \""<<(o.brute?"brute":"bvh")<<"\",\n  \"frames\": [\n";
        for(int frame=0;frame<o.frames;++frame) {
            auto start=Clock::now(); auto scene=make_scene(frame); std::unique_ptr<BVH> bvh;
            if(!o.brute) bvh=std::make_unique<BVH>(scene);
            auto built=Clock::now(); Counters counts; auto pixels=render(scene,bvh.get(),o,counts);
            auto rendered=Clock::now(); std::ostringstream name;
            name<<"frame_"<<std::setw(4)<<std::setfill('0')<<frame<<".png";
            write_png(o.output/name.str(),o.width,o.height,pixels); auto encoded=Clock::now();
            trace<<"    {\"frame\": "<<frame<<", \"build_ms\": "<<milliseconds(start,built)
                 <<", \"render_ms\": "<<milliseconds(built,rendered)<<", \"encode_ms\": "<<milliseconds(rendered,encoded)
                 <<", \"total_ms\": "<<milliseconds(start,encoded)<<", \"primary_rays\": "<<counts.primary_rays
                 <<", \"shadow_rays\": "<<counts.shadow_rays<<", \"primitive_tests\": "<<counts.primitive_tests
                 <<", \"box_tests\": "<<counts.box_tests<<"}"<<(frame+1<o.frames?",":"")<<'\n';
        }
        trace<<"  ]\n}\n"; trace.close();
        std::cout<<"Wrote "<<o.frames<<" frames and "<<(o.output/"trace.json")<<'\n';
    } catch(const std::exception& error) { std::cerr<<"error: "<<error.what()<<'\n'; return 2; }
}
