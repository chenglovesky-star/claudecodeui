package com.iflytek.bigdata.flint.analysis.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;

import java.util.List;

public interface IImpalaQueryHistoryService {

    List<ImpalaQueryHistoryWithBLOBs> select(ImpalaQueryHistoryWithBLOBs item);

    PageInfo<ImpalaQueryHistoryWithBLOBs> selectByPage(ImpalaQueryHistoryWithBLOBs item, int pageNum, int pageSize);

    void insert(ImpalaQueryHistoryWithBLOBs item);

    void update(ImpalaQueryHistoryWithBLOBs item);

    void delete(Long id);

    ImpalaQueryHistoryWithBLOBs selectById(Long id);

    List<ImpalaQueryHistoryWithBLOBs> selectBySql(String sql);

    ImpalaQueryHistoryWithBLOBs selectStatusAndMessage(Long id);
}
