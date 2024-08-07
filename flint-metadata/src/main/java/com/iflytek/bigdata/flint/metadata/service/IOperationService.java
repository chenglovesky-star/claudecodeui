package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.Operation;

import java.util.List;

public interface IOperationService {

    List<Operation> select(Operation item);

    PageInfo<Operation> selectByPage(Operation item, int pageNum, int pageSize);

    void insert(Operation item);

    void update(Operation item);

    void delete(Integer id);

    Operation selectById(Integer id);

}
