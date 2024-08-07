package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.DimColumnMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumnExample;
import com.iflytek.bigdata.flint.metadata.service.IDimColumnService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class DimColumnServiceImpl implements IDimColumnService {

    @Resource
    DimColumnMapper dimColumnMapper;

    @Override
    public List<DimColumn> select(DimColumn item) {
        DimColumnExample example = new DimColumnExample();
        DimColumnExample.Criteria criteria = example.createCriteria();
        if (item.getDimId() != null) criteria.andDimIdEqualTo(item.getDimId());
        if (StringUtils.isNotEmpty(item.getName())) criteria.andNameLike("%" + item.getName() + "%");
        return dimColumnMapper.selectByExample(example);
    }

    @Override
    public PageInfo<DimColumn> selectByPage(DimColumn item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<DimColumn> list = select(item);
        PageInfo<DimColumn> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(DimColumn item) {
        dimColumnMapper.insertSelective(item);
    }

    @Override
    public void update(DimColumn item) {
        dimColumnMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        dimColumnMapper.deleteByPrimaryKey(id);
    }

    @Override
    public DimColumn selectById(Integer id) {
        return dimColumnMapper.selectByPrimaryKey(id);
    }

}
