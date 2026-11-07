#pragma once
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <vector>
#include <zlib.h>

namespace rt {
inline void big_endian(std::vector<unsigned char>& bytes, uint32_t value) {
    for(int shift=24;shift>=0;shift-=8) bytes.push_back(static_cast<unsigned char>(value>>shift));
}
inline void chunk(std::vector<unsigned char>& png,const char* type,const std::vector<unsigned char>& data) {
    big_endian(png,static_cast<uint32_t>(data.size())); size_t begin=png.size();
    png.insert(png.end(),type,type+4); png.insert(png.end(),data.begin(),data.end());
    big_endian(png,static_cast<uint32_t>(crc32(0,png.data()+begin,static_cast<uInt>(4+data.size()))));
}
inline void write_png(const std::filesystem::path& path,int width,int height,const std::vector<unsigned char>& rgb) {
    std::vector<unsigned char> raw;
    raw.reserve(static_cast<size_t>(height)*(1+3*width));
    for(int y=0;y<height;++y) {
        raw.push_back(0); // PNG filter type: none.
        auto row=rgb.begin()+static_cast<size_t>(y)*3*width;
        raw.insert(raw.end(),row,row+3*width);
    }
    uLongf size=compressBound(raw.size()); std::vector<unsigned char> compressed(size);
    if(compress2(compressed.data(),&size,raw.data(),raw.size(),Z_BEST_SPEED)!=Z_OK)
        throw std::runtime_error("PNG compression failed");
    compressed.resize(size);
    std::vector<unsigned char> png{137,80,78,71,13,10,26,10}, header;
    big_endian(header,width); big_endian(header,height);
    header.insert(header.end(),{8,2,0,0,0}); // 8-bit RGB, no interlacing.
    chunk(png,"IHDR",header); chunk(png,"IDAT",compressed); chunk(png,"IEND",{});
    std::ofstream file(path,std::ios::binary); file.exceptions(std::ios::failbit|std::ios::badbit);
    file.write(reinterpret_cast<const char*>(png.data()),static_cast<std::streamsize>(png.size()));
    file.close();
}
}
