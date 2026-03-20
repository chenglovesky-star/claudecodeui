package com.iflytek.bigdata.flint.analysis.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultWithBLOBs;

import java.util.List;

public interface IImpalaQueryResultService {

    List<ImpalaQueryResultWithBLOBs> select(ImpalaQueryResultWithBLOBs item);

    PageInfo<ImpalaQueryResultWithBLOBs> selectByPage(ImpalaQueryResultWithBLOBs item, int pageNum, int pageSize);

    void insert(ImpalaQueryResultWithBLOBs item);

    void update(ImpalaQueryResultWithBLOBs item);

    void delete(Long id);

    ImpalaQueryResultWithBLOBs selectById(Long id);

    ImpalaQueryResultWithBLOBs selectByHistoryId(Long historyId);
}
