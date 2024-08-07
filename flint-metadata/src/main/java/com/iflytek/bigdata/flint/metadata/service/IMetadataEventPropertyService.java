package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;

import java.util.List;

public interface IMetadataEventPropertyService {

    List<MetadataEventProperty> select(MetadataEventProperty item);

    PageInfo<MetadataEventProperty> selectByPage(MetadataEventProperty item, int pageNum, int pageSize);

    void insert(MetadataEventProperty item);

    void update(MetadataEventProperty item);

    void delete(Integer id);

    MetadataEventProperty selectById(Integer id);

    MetadataEventProperty selectByEventAndName(String event, String name);

    void incEventPropertySort(String eventName, String propertyName);

    List<MetadataEventProperty> selectCommonProperty(String[] events, int eventSize);

    List<MetadataEventProperty> selectUnionProperty(String[] events, int eventSize);

}
