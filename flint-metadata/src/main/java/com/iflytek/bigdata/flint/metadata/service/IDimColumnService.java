package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;

import java.util.List;

public interface IDimColumnService {

    List<DimColumn> select(DimColumn item);

    PageInfo<DimColumn> selectByPage(DimColumn item, int pageNum, int pageSize);

    void insert(DimColumn item);

    void update(DimColumn item);

    void delete(Integer id);

    DimColumn selectById(Integer id);

}
