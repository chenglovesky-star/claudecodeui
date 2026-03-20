package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.Dim;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;

import java.util.List;

public interface IDimService {

    List<Dim> select(Dim item);

    PageInfo<Dim> selectByPage(Dim item, int pageNum, int pageSize);

    void insert(Dim item);

    void update(Dim item);

    void delete(Integer id);

    Dim selectById(Integer id);

    List<DimColumn> selectDimColumns(String event);

}
