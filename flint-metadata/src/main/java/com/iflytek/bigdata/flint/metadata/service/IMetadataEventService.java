package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEvent;

import java.util.List;

public interface IMetadataEventService {

    List<MetadataEvent> select(MetadataEvent item);

    PageInfo<MetadataEvent> selectByPage(MetadataEvent item, int pageNum, int pageSize);

    void insert(MetadataEvent item);

    void update(MetadataEvent item);

    void delete(Integer id);

    MetadataEvent selectById(Integer id);

    MetadataEvent selectByName(String event);

    void incSort(String eventName);

}
