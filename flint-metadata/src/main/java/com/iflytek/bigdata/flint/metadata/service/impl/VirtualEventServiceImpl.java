package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.VirtualEventMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.VirtualEventExample;
import com.iflytek.bigdata.flint.metadata.dao.model.VirtualEventWithBLOBs;
import com.iflytek.bigdata.flint.metadata.service.IVirtualEventService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class VirtualEventServiceImpl implements IVirtualEventService {

    @Resource
    VirtualEventMapper virtualEventMapper;

    @Override
    public List<VirtualEventWithBLOBs> select(VirtualEventWithBLOBs item) {
        VirtualEventExample example = new VirtualEventExample();
        VirtualEventExample.Criteria criteria = example.createCriteria();
        if (item != null) {
            if (StringUtils.isNotEmpty(item.getName())) {
                criteria.andNameEqualTo(item.getName());
            }
            if (StringUtils.isNotEmpty(item.getAddUser())) {
                criteria.andAddUserEqualTo(item.getAddUser());
            }
            if (StringUtils.isNotEmpty(item.getTags())) {
                criteria.andTagsLike("%" + item.getTags() + "%");
            }
            if (item.getDisplay() != null) {
                criteria.andDisplayEqualTo(item.getDisplay());
            }
            if (StringUtils.isNotEmpty(item.getDisplayName())) {
                criteria.andDisplayNameLike("%" + item.getDisplayName() + "%");
            }
        }
        return virtualEventMapper.selectByExampleWithBLOBs(example);
    }

    @Override
    public PageInfo<VirtualEventWithBLOBs> selectByPage(VirtualEventWithBLOBs item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<VirtualEventWithBLOBs> list = select(item);
        PageInfo<VirtualEventWithBLOBs> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(VirtualEventWithBLOBs item) {
        virtualEventMapper.insertSelective(item);
    }

    @Override
    public void update(VirtualEventWithBLOBs item) {
        virtualEventMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        virtualEventMapper.deleteByPrimaryKey(id);
    }

    @Override
    public VirtualEventWithBLOBs selectById(Integer id) {
        return virtualEventMapper.selectByPrimaryKey(id);
    }

    @Override
    public boolean exists(String name) {
        VirtualEventExample example = new VirtualEventExample();
        VirtualEventExample.Criteria criteria = example.createCriteria();
        criteria.andNameEqualTo(name);
        long cnt = virtualEventMapper.countByExample(example);
        return cnt > 0L ? true : false;
    }

    @Override
    public boolean exists(Integer id, String name) {
        VirtualEventExample example = new VirtualEventExample();
        VirtualEventExample.Criteria criteria = example.createCriteria();
        criteria.andNameEqualTo(name);
        criteria.andIdNotEqualTo(id);
        long cnt = virtualEventMapper.countByExample(example);
        return cnt > 0L ? true : false;
    }

    @Override
    public VirtualEventWithBLOBs selectByName(String event) {
        VirtualEventExample example = new VirtualEventExample();
        VirtualEventExample.Criteria criteria = example.createCriteria();
        criteria.andNameEqualTo(event);
        List<VirtualEventWithBLOBs> list = virtualEventMapper.selectByExampleWithBLOBs(example);
        if (CollectionUtils.isNotEmpty(list)) {
            return list.get(0);
        }
        return null;
    }

}
