package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventPropertyValue;

import java.util.List;

public interface IMetadataEventPropertyValueService {

    List<MetadataEventPropertyValue> select(MetadataEventPropertyValue item);

    PageInfo<MetadataEventPropertyValue> selectByPage(MetadataEventPropertyValue item, int pageNum, int pageSize);

    void insert(MetadataEventPropertyValue item);

    void update(MetadataEventPropertyValue item);

    void delete(Integer id);

    MetadataEventPropertyValue selectById(Integer id);

}
