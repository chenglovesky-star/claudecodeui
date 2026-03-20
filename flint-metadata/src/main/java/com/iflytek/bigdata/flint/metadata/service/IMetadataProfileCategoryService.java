package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileCategory;

import java.util.List;

public interface IMetadataProfileCategoryService {

    List<MetadataProfileCategory> select(MetadataProfileCategory item);

    PageInfo<MetadataProfileCategory> selectByPage(MetadataProfileCategory item, int pageNum, int pageSize);

    void insert(MetadataProfileCategory item);

    void update(MetadataProfileCategory item);

    void delete(Integer id);

    MetadataProfileCategory selectById(Integer id);

}
