package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.MetadataEventPropertyMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventPropertyExample;
import com.iflytek.bigdata.flint.metadata.service.IMetadataEventPropertyService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class MetadataEventPropertyServiceImpl implements IMetadataEventPropertyService {

    @Resource
    MetadataEventPropertyMapper metadataEventPropertyMapper;

    @Override
    public List<MetadataEventProperty> select(MetadataEventProperty item) {
        MetadataEventPropertyExample example = new MetadataEventPropertyExample();
        MetadataEventPropertyExample.Criteria criteria = example.createCriteria();
        if (StringUtils.isNotEmpty(item.getEventName())) {
            criteria.andEventNameEqualTo(item.getEventName());
        }
        if (StringUtils.isNotEmpty(item.getName())) {
            criteria.andNameLike("%" + item.getName() + "%");
        }
        if (StringUtils.isNotEmpty(item.getShowName())) {
            criteria.andShowNameLike("%" + item.getShowName() + "%");
        }
        if (item.getDisplay() != null) {
            criteria.andDisplayEqualTo(item.getDisplay());
        }
        return metadataEventPropertyMapper.selectByExample(example);
    }

    @Override
    public PageInfo<MetadataEventProperty> selectByPage(MetadataEventProperty item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<MetadataEventProperty> list = select(item);
        PageInfo<MetadataEventProperty> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(MetadataEventProperty item) {
        metadataEventPropertyMapper.insertSelective(item);
    }

    @Override
    public void update(MetadataEventProperty item) {
        metadataEventPropertyMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        metadataEventPropertyMapper.deleteByPrimaryKey(id);
    }

    @Override
    public MetadataEventProperty selectById(Integer id) {
        return metadataEventPropertyMapper.selectByPrimaryKey(id);
    }

    @Override
    public MetadataEventProperty selectByEventAndName(String event, String name) {
        MetadataEventPropertyExample example = new MetadataEventPropertyExample();
        MetadataEventPropertyExample.Criteria criteria = example.createCriteria();
        criteria.andEventNameEqualTo(event);
        criteria.andNameEqualTo(name);
        List<MetadataEventProperty> list = metadataEventPropertyMapper.selectByExample(example);
        if (CollectionUtils.isNotEmpty(list)) {
            return list.get(0);
        }
        return null;
    }

    @Override
    public void incEventPropertySort(String eventName, String propertyName) {
        metadataEventPropertyMapper.incEventPropertySort(eventName, propertyName);
    }

    @Override
    public List<MetadataEventProperty> selectCommonProperty(String[] events, int eventSize) {
        return metadataEventPropertyMapper.selectCommonProperty(events,eventSize);
    }

    @Override
    public List<MetadataEventProperty> selectUnionProperty(String[] events, int eventSize) {
        return metadataEventPropertyMapper.selectUnionProperty(events,eventSize);
    }
}
