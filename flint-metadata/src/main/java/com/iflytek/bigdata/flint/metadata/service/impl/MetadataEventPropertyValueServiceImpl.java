package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.MetadataEventPropertyValueMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventPropertyValue;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventPropertyValueExample;
import com.iflytek.bigdata.flint.metadata.service.IMetadataEventPropertyValueService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class MetadataEventPropertyValueServiceImpl implements IMetadataEventPropertyValueService {

    @Resource
    MetadataEventPropertyValueMapper metadataEventPropertyValueMapper;

    @Override
    public List<MetadataEventPropertyValue> select(MetadataEventPropertyValue item) {
        MetadataEventPropertyValueExample example = new MetadataEventPropertyValueExample();
        MetadataEventPropertyValueExample.Criteria criteria = example.createCriteria();
        if (StringUtils.isNotEmpty(item.getEvent())) criteria.andEventEqualTo(item.getEvent());
        if (StringUtils.isNotEmpty(item.getProperty())) criteria.andPropertyEqualTo(item.getProperty());
        return metadataEventPropertyValueMapper.selectByExampleWithBLOBs(example);
    }

    @Override
    public PageInfo<MetadataEventPropertyValue> selectByPage(MetadataEventPropertyValue item, int pageNum,
            int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<MetadataEventPropertyValue> list = select(item);
        PageInfo<MetadataEventPropertyValue> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(MetadataEventPropertyValue item) {
        metadataEventPropertyValueMapper.insertSelective(item);
    }

    @Override
    public void update(MetadataEventPropertyValue item) {
        metadataEventPropertyValueMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        metadataEventPropertyValueMapper.deleteByPrimaryKey(id);
    }

    @Override
    public MetadataEventPropertyValue selectById(Integer id) {
        return metadataEventPropertyValueMapper.selectByPrimaryKey(id);
    }

}
