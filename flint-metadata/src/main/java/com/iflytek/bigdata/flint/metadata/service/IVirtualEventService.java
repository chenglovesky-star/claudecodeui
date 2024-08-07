package com.iflytek.bigdata.flint.metadata.service;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.model.VirtualEventWithBLOBs;

import java.util.List;

public interface IVirtualEventService {

    List<VirtualEventWithBLOBs> select(VirtualEventWithBLOBs item);

    PageInfo<VirtualEventWithBLOBs> selectByPage(VirtualEventWithBLOBs item, int pageNum, int pageSize);

    void insert(VirtualEventWithBLOBs item);

    void update(VirtualEventWithBLOBs item);

    void delete(Integer id);

    VirtualEventWithBLOBs selectById(Integer id);

    boolean exists(String name);

    boolean exists(Integer id, String name);

    VirtualEventWithBLOBs selectByName(String event);
}
