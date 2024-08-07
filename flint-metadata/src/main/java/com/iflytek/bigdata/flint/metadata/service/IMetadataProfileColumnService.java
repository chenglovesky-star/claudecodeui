package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumn;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumnExample;

import java.util.List;

public interface IMetadataProfileColumnService {

    List<MetadataProfileColumn> selectByExample(MetadataProfileColumnExample example);

    List<MetadataProfileColumn> select(MetadataProfileColumn item);

    PageInfo<MetadataProfileColumn> selectByPage(MetadataProfileColumn item, int pageNum, int pageSize);

    void insert(MetadataProfileColumn item);

    void update(MetadataProfileColumn item);

    void delete(Integer id);

    MetadataProfileColumn selectById(Integer id);

    MetadataProfileColumn selectByName(String name);
}
