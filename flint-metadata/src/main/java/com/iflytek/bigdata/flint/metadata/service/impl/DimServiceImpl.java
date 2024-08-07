package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.DimMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.Dim;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;
import com.iflytek.bigdata.flint.metadata.dao.model.DimExample;
import com.iflytek.bigdata.flint.metadata.service.IDimColumnService;
import com.iflytek.bigdata.flint.metadata.service.IDimService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;

@Service
public class DimServiceImpl implements IDimService {

    @Resource
    private DimMapper dimMapper;

    @Resource
    private IDimColumnService iDimColumnService;

    @Override
    public List<Dim> select(Dim item) {
        DimExample example = new DimExample();
        DimExample.Criteria criteria = example.createCriteria();
        if (StringUtils.isNotEmpty(item.getName())) criteria.andNameLike("%" + item.getName() + "%");
        if (StringUtils.isNotEmpty(item.getHiveTableName())) criteria.andHiveTableNameEqualTo(item.getHiveTableName());
        if (StringUtils.isNotEmpty(item.getEvent())) criteria.andEventEqualTo(item.getEvent());
        return dimMapper.selectByExample(example);
    }

    @Override
    public PageInfo<Dim> selectByPage(Dim item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<Dim> list = select(item);
        PageInfo<Dim> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(Dim item) {
        dimMapper.insertSelective(item);
    }

    @Override
    public void update(Dim item) {
        dimMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        dimMapper.deleteByPrimaryKey(id);
    }

    @Override
    public Dim selectById(Integer id) {
        return dimMapper.selectByPrimaryKey(id);
    }

    @Override
    public List<DimColumn> selectDimColumns(String event) {
        Dim item = new Dim();
        item.setEvent(event);
        List<Dim> dims = select(item);
        List<DimColumn> dimColumnList = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(dims)) {
            for (Dim dim : dims) {
                DimColumn search = new DimColumn();
                search.setDimId(dim.getId());
                List<DimColumn> list = iDimColumnService.select(search);
                if (CollectionUtils.isNotEmpty(list)) {
                    dimColumnList.addAll(list);
                }
            }
        }
        return dimColumnList;
    }

}
