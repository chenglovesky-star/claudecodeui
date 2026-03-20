package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.MetadataEventMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEvent;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventExample;
import com.iflytek.bigdata.flint.metadata.service.IMetadataEventService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class MetadataEventServiceImpl implements IMetadataEventService {

    @Resource
    MetadataEventMapper metadataEventMapper;

    @Override
    public List<MetadataEvent> select(MetadataEvent item) {
        MetadataEventExample example = new MetadataEventExample();
        MetadataEventExample.Criteria criteria = example.createCriteria();
        if (item != null) {
            if (StringUtils.isNotEmpty(item.getName())) {
                criteria.andNameLike("%" + item.getName() + "%");
            }
            if (StringUtils.isNotEmpty(item.getShowName())) {
                criteria.andShowNameLike("%" + item.getShowName() + "%");
            }
            if (StringUtils.isNotEmpty(item.getTags())) {
                criteria.andTagsEqualTo(item.getTags());
            }
            if (item.getDisplay() != null) {
                criteria.andDisplayEqualTo(item.getDisplay());
            }
            if (StringUtils.isNotEmpty(item.getModules())) {
                if ("NULL".equals(item.getModules())) {
                    criteria.andModulesEqualTo("");
                } else {
                    criteria.andModulesEqualTo(item.getModules());
                }
            }
            if (item.getModuleSet() != null) {
                if (CollectionUtils.isEmpty(item.getModuleSet())) {
                    item.getModuleSet().add("null");
                }
                criteria.andModulesIn(item.getModuleSet());
            }
        }
        return metadataEventMapper.selectByExample(example);
    }

    @Override
    public PageInfo<MetadataEvent> selectByPage(MetadataEvent item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<MetadataEvent> list = select(item);
        PageInfo<MetadataEvent> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(MetadataEvent item) {
        metadataEventMapper.insertSelective(item);
    }

    @Override
    public void update(MetadataEvent item) {
        metadataEventMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        metadataEventMapper.deleteByPrimaryKey(id);
    }

    @Override
    public MetadataEvent selectById(Integer id) {
        return metadataEventMapper.selectByPrimaryKey(id);
    }

    @Override
    public MetadataEvent selectByName(String event) {
        MetadataEventExample example = new MetadataEventExample();
        MetadataEventExample.Criteria criteria = example.createCriteria();
        criteria.andNameEqualTo(event);
        List<MetadataEvent> list = metadataEventMapper.selectByExample(example);
        if (!CollectionUtils.isEmpty(list)) return list.get(0);
        return null;
    }

    @Override
    public void incSort(String eventName) {
        metadataEventMapper.incSort(eventName);
    }

}
