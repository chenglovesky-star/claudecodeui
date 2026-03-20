package com.iflytek.bigdata.flint.metadata.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.metadata.dao.mapper.OperationMapper;
import com.iflytek.bigdata.flint.metadata.dao.model.Operation;
import com.iflytek.bigdata.flint.metadata.dao.model.OperationExample;
import com.iflytek.bigdata.flint.metadata.service.IOperationService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class OperationServiceImpl implements IOperationService {

    @Resource
    OperationMapper operationMapper;

    @Override
    public List<Operation> select(Operation item) {
        OperationExample example = new OperationExample();
        OperationExample.Criteria criteria = example.createCriteria();
        if (item.getColumnType() != null) criteria.andColumnTypeEqualTo(item.getColumnType());
        return operationMapper.selectByExample(example);
    }

    @Override
    public PageInfo<Operation> selectByPage(Operation item, int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<Operation> list = select(item);
        PageInfo<Operation> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(Operation item) {
        operationMapper.insertSelective(item);
    }

    @Override
    public void update(Operation item) {
        operationMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Integer id) {
        operationMapper.deleteByPrimaryKey(id);
    }

    @Override
    public Operation selectById(Integer id) {
        return operationMapper.selectByPrimaryKey(id);
    }

}
