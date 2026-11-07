#include "geometry.hpp"
#include <iostream>
#include <random>
#include <stdexcept>
using namespace rt;
void check(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
int main() {
    const auto sphere = Primitive::sphere({0,0,0}, 1, {1,0,0});
    Hit hit; Counters counters;
    check(intersect(sphere, {{0,0,3},{0,0,-1}}, 0.0001, 100, hit), "front sphere hit");
    check(std::abs(hit.t-2)<1e-10, "nearest sphere root");
    check(intersect(sphere, {{0,0,0},{0,0,2}}, 0.0001, 100, hit), "inside non-unit ray");
    check(std::abs(hit.t-.5)<1e-10, "inside sphere exit");
    check(intersect(sphere, {{1,0,3},{0,0,-1}}, 0.0001, 100, hit), "tangent");
    check(!intersect(sphere, {{0,0,3},{0,0,1}}, .0001, 100, hit), "behind origin");
    check(!intersect(sphere, {{0,0,3},{0,0,-1}}, .0001, 1.9, hit), "bounded shadow ray");
    auto tri = Primitive::triangle({-1,-1,0},{1,-1,0},{0,1,0},{0,1,0});
    check(intersect(tri, {{0,0,2},{0,0,-1}}, .0001, 10, hit), "triangle hit");
    check(!intersect(tri, {{2,0,2},{0,0,-1}}, .0001, 10, hit), "outside triangle");
    check(!intersect(tri, {{0,0,2},{1,0,0}}, .0001, 10, hit), "parallel triangle");
    Box box; box.extend({-1,-1,-1}); box.extend({1,1,1});
    check(box.hit({{1,0,3},{0,0,-1}}, 0, 10), "parallel ray on slab boundary");
    check(!box.hit({{2,0,3},{0,0,-1}}, 0, 10), "parallel ray outside slab");
    std::vector<Primitive> scene{tri};
    for(int x=-5;x<=5;++x) for(int y=-5;y<=5;++y)
        scene.push_back(Primitive::sphere({x*2.5,y*2.5,-3}, .8, {1,0,0}));
    BVH bvh(scene); std::mt19937 gen(42); std::uniform_real_distribution<double> d(-15,15);
    Counters fast, slow;
    for(int i=0;i<5000;++i) {
        Ray r{{d(gen),d(gen),10},{d(gen)*.1,d(gen)*.1,-1}}; Hit a,b;
        bool ba=bvh.closest(r, .0001, 100, a, fast);
        bool bb=brute(scene,r,.0001,100,b,slow);
        check(ba==bb,"BVH hit agrees with brute force");
        if(ba) { check(std::abs(a.t-b.t)<1e-9,"BVH nearest distance"); check(a.id==b.id,"BVH primitive identity"); }
    }
    check(fast.primitive_tests < slow.primitive_tests/4,"BVH reduces primitive tests");
    std::vector<Primitive> empty; BVH empty_bvh(empty);
    check(!empty_bvh.closest({{0,0,1},{0,0,-1}},.001,10,hit,counters),"empty BVH");
    std::vector<Primitive> ties(12,sphere); BVH tied(ties);
    check(tied.closest({{0,0,3},{0,0,-1}},.001,10,hit,counters)&&hit.id==0,"deterministic overlapping geometry");
    std::cout << "Geometry checks passed; 5000 BVH/reference rays, primitive tests "
              << fast.primitive_tests << " / " << slow.primitive_tests << '\n';
}
