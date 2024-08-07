package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.MetadataProfileColumnMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumn;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumnExample;
import com.iflytek.bigdata.flint.metadata.service.IMetadataProfileColumnService;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class MetadataProfileColumnServiceImpl implements IMetadataProfileColumnService {

    @Resource
    MetadataProfileColumnMapper metadataProfileColumnMapper;

    @Override
    public List<MetadataProfileColumn> selectByExample(MetadataProfileColumnExample example) {
        return metadataProfileColumnMapper.selectByExample(example);
    }

    @Override
    public List<MetadataProfileColumn> select(MetadataProfileColumn item) {
        MetadataProfileColumnExample example = new MetadataProfileColumnExample();
        MetadataProfileColumnExample.Criteria criteria = example.createCriteria();
        if (item != null) {
            if (StringUtils.isNotEmpty(item.getName())) {
                criteria.andNameEqualTo(item.getName());
            }
            if (item.getCategoryId() != null) {
                criteria.andCategoryIdEqualTo(item.getCategoryId());
            }
            if (item.getDisplay() != null) {
                criteria.andDisplayEqualTo(item.getDisplay());
            }
        }
        return metadataProfileColumnMapper.selectByExample(example);
    }

    @Override
    public PageInfo<MetadataProfileColumn> selectByPage(MetadataProfileColumn item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<MetadataProfileColumn> list = select(item);
        PageInfo<MetadataProfileColumn> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(MetadataProfileColumn item) {
        metadataProfileColumnMapper.insertSelective(item);
    }

    @Override
    public void update(MetadataProfileColumn item) {
        metadataProfileColumnMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        metadataProfileColumnMapper.deleteByPrimaryKey(id);
    }

    @Override
    public MetadataProfileColumn selectById(Integer id) {
        return metadataProfileColumnMapper.selectByPrimaryKey(id);
    }

    @Override
    public MetadataProfileColumn selectByName(String name) {
        MetadataProfileColumnExample example = new MetadataProfileColumnExample();
        MetadataProfileColumnExample.Criteria criteria = example.createCriteria();
        criteria.andNameEqualTo(name);
        List<MetadataProfileColumn> list = metadataProfileColumnMapper.selectByExample(example);
        if (CollectionUtils.isNotEmpty(list)) {
            return list.get(0);
        }
        return null;
    }

}
