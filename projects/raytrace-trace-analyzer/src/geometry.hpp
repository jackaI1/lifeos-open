#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <numeric>
#include <vector>

namespace rt {
struct Vec {
    double x=0, y=0, z=0;
    double operator[](int axis) const { return axis==0?x:axis==1?y:z; }
    Vec operator+(Vec v) const { return {x+v.x,y+v.y,z+v.z}; }
    Vec operator-(Vec v) const { return {x-v.x,y-v.y,z-v.z}; }
    Vec operator*(double s) const { return {x*s,y*s,z*s}; }
    Vec operator*(Vec v) const { return {x*v.x,y*v.y,z*v.z}; }
};
inline double dot(Vec a, Vec b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
inline Vec cross(Vec a, Vec b) { return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x}; }
inline Vec unit(Vec v) { return v*(1/std::sqrt(dot(v,v))); }
struct Ray { Vec origin, direction; };
struct Box {
    Vec lo{INFINITY,INFINITY,INFINITY}, hi{-INFINITY,-INFINITY,-INFINITY};
    void extend(Vec p) { lo={std::min(lo.x,p.x),std::min(lo.y,p.y),std::min(lo.z,p.z)};
                        hi={std::max(hi.x,p.x),std::max(hi.y,p.y),std::max(hi.z,p.z)}; }
    void unite(const Box& b) { extend(b.lo); extend(b.hi); }
    bool hit(const Ray& ray, double near, double far) const {
        for(int a=0;a<3;++a) {
            // Explicit zero handling avoids 0 * infinity NaNs on slab boundaries.
            if(ray.direction[a]==0) { if(ray.origin[a]<lo[a]||ray.origin[a]>hi[a]) return false; continue; }
            double t0=(lo[a]-ray.origin[a])/ray.direction[a], t1=(hi[a]-ray.origin[a])/ray.direction[a];
            if(t0>t1) std::swap(t0,t1);
            near=std::max(near,t0); far=std::min(far,t1);
            if(far<near) return false;
        }
        return true;
    }
};
struct Primitive {
    bool is_sphere; Vec a,b,c,color; double radius;
    static Primitive sphere(Vec center,double radius,Vec color) { return {true,center,{},{},color,radius}; }
    static Primitive triangle(Vec a,Vec b,Vec c,Vec color) { return {false,a,b,c,color,0}; }
    Box bounds() const {
        Box box;
        if(is_sphere) { Vec r{radius,radius,radius}; box.extend(a-r); box.extend(a+r); }
        else { box.extend(a); box.extend(b); box.extend(c); }
        return box;
    }
};
struct Hit { double t=INFINITY; Vec normal; size_t id=std::numeric_limits<size_t>::max(); };
struct Counters { uint64_t primary_rays=0, shadow_rays=0, primitive_tests=0, box_tests=0; };
inline bool intersect(const Primitive& p,const Ray& ray,double near,double far,Hit& hit) {
    double t; Vec normal;
    if(p.is_sphere) {
        Vec oc=ray.origin-p.a;
        double a=dot(ray.direction,ray.direction), half_b=dot(oc,ray.direction);
        double disc=half_b*half_b-a*(dot(oc,oc)-p.radius*p.radius);
        if(disc<0||a==0) return false;
        t=(-half_b-std::sqrt(disc))/a;
        if(t<near||t>far) { t=(-half_b+std::sqrt(disc))/a; if(t<near||t>far) return false; }
        normal=(ray.origin+ray.direction*t-p.a)*(1/p.radius);
    } else {
        Vec e1=p.b-p.a,e2=p.c-p.a,h=cross(ray.direction,e2);
        double det=dot(e1,h); if(std::abs(det)<1e-12) return false;
        Vec s=ray.origin-p.a; double u=dot(s,h)/det;
        if(u<0||u>1) return false;
        Vec q=cross(s,e1); double v=dot(ray.direction,q)/det;
        if(v<0||u+v>1) return false;
        t=dot(e2,q)/det; if(t<near||t>far) return false;
        normal=unit(cross(e1,e2));
    }
    if(dot(normal,ray.direction)>0) normal=normal*(-1);
    hit.t=t; hit.normal=normal; return true;
}
inline bool test_primitive(const std::vector<Primitive>& scene,size_t id,const Ray& ray,
                           double near,double far,Hit& best,Counters& counts) {
    ++counts.primitive_tests; Hit candidate;
    if(!intersect(scene[id],ray,near,std::min(far,best.t),candidate)) return false;
    // Stable tie-breaking ensures identical shading for overlapping surfaces.
    if(candidate.t<best.t || (candidate.t==best.t && id<best.id)) { best=candidate; best.id=id; }
    return true;
}
inline bool brute(const std::vector<Primitive>& scene,const Ray& ray,double near,double far,Hit& best,Counters& counts) {
    best=Hit{}; bool found=false;
    for(size_t i=0;i<scene.size();++i) found=test_primitive(scene,i,ray,near,far,best,counts)||found;
    return found;
}
class BVH {
    struct Node { Box box; size_t begin=0,end=0; int left=-1,right=-1; };
    const std::vector<Primitive>& scene_;
    std::vector<size_t> ids_;
    std::vector<Node> nodes_;
    int build(size_t begin,size_t end) {
        Node node; node.begin=begin; node.end=end;
        for(size_t i=begin;i<end;++i) node.box.unite(scene_[ids_[i]].bounds());
        int index=static_cast<int>(nodes_.size()); nodes_.push_back(node);
        if(end-begin<=4) return index;
        Vec extent=node.box.hi-node.box.lo;
        int axis=extent.y>extent.x?1:0; if(extent.z>extent[axis]) axis=2;
        size_t mid=begin+(end-begin)/2;
        std::nth_element(ids_.begin()+begin,ids_.begin()+mid,ids_.begin()+end,[&](size_t a,size_t b){
            auto ba=scene_[a].bounds(),bb=scene_[b].bounds();
            double ca=ba.lo[axis]+ba.hi[axis],cb=bb.lo[axis]+bb.hi[axis];
            return ca==cb?a<b:ca<cb;
        });
        int left=build(begin,mid), right=build(mid,end);
        nodes_[index].left=left; nodes_[index].right=right;
        return index;
    }
    bool visit(int index,const Ray& ray,double near,double far,Hit& best,Counters& counts) const {
        const Node& node=nodes_[index]; ++counts.box_tests;
        if(!node.box.hit(ray,near,std::min(far,best.t))) return false;
        if(node.left<0) {
            bool found=false;
            for(size_t i=node.begin;i<node.end;++i) found=test_primitive(scene_,ids_[i],ray,near,far,best,counts)||found;
            return found;
        }
        bool left=visit(node.left,ray,near,far,best,counts);
        bool right=visit(node.right,ray,near,far,best,counts);
        return left||right;
    }
public:
    // Scene storage must outlive the BVH and remain unchanged while tracing.
    explicit BVH(const std::vector<Primitive>& scene):scene_(scene),ids_(scene.size()) {
        std::iota(ids_.begin(),ids_.end(),0); if(!scene.empty()) build(0,scene.size());
    }
    bool closest(const Ray& ray,double near,double far,Hit& best,Counters& counts) const {
        best=Hit{}; return !nodes_.empty()&&visit(0,ray,near,far,best,counts);
    }
};
}
