package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.MetadataProfileCategoryMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileCategory;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileCategoryExample;
import com.iflytek.bigdata.flint.metadata.service.IMetadataProfileCategoryService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class MetadataProfileCategoryServiceImpl implements IMetadataProfileCategoryService {

    @Resource
    MetadataProfileCategoryMapper metadataProfileCategoryMapper;

    @Override
    public List<MetadataProfileCategory> select(MetadataProfileCategory item) {
        MetadataProfileCategoryExample example = new MetadataProfileCategoryExample();
        MetadataProfileCategoryExample.Criteria criteria = example.createCriteria();
        if (item != null) {
            if (StringUtils.isNotEmpty(item.getName())) {
                criteria.andNameLike("%" + item.getName() + "%");
            }
            if (item.getDisplay() != null) {
                criteria.andDisplayEqualTo(item.getDisplay());
            }
        }
        return metadataProfileCategoryMapper.selectByExample(example);
    }

    @Override
    public PageInfo<MetadataProfileCategory> selectByPage(MetadataProfileCategory item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<MetadataProfileCategory> list = select(item);
        PageInfo<MetadataProfileCategory> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(MetadataProfileCategory item) {
        metadataProfileCategoryMapper.insertSelective(item);
    }

    @Override
    public void update(MetadataProfileCategory item) {
        metadataProfileCategoryMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        metadataProfileCategoryMapper.deleteByPrimaryKey(id);
    }

    @Override
    public MetadataProfileCategory selectById(Integer id) {
        return metadataProfileCategoryMapper.selectByPrimaryKey(id);
    }

}
