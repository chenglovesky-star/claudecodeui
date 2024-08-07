package com.iflytek.bigdata.flint.analysis.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.analysis.dao.mapper.ImpalaQueryResultMapper;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultExample;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultWithBLOBs;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryResultService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class ImpalaQueryResultServiceImpl implements IImpalaQueryResultService {

    @Resource
    ImpalaQueryResultMapper impalaQueryResultMapper;

    @Override
    public List<ImpalaQueryResultWithBLOBs> select(ImpalaQueryResultWithBLOBs item) {
        ImpalaQueryResultExample example = new ImpalaQueryResultExample();
        ImpalaQueryResultExample.Criteria criteria = example.createCriteria();
        if (item.getHistoryId() != null) {
            criteria.andHistoryIdEqualTo(item.getHistoryId());
        }
        return impalaQueryResultMapper.selectByExampleWithBLOBs(example);
    }

    @Override
    public PageInfo<ImpalaQueryResultWithBLOBs> selectByPage(ImpalaQueryResultWithBLOBs item, int pageNum,
                                                             int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<ImpalaQueryResultWithBLOBs> list = select(item);
        PageInfo<ImpalaQueryResultWithBLOBs> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(ImpalaQueryResultWithBLOBs item) {
        impalaQueryResultMapper.insertSelective(item);
    }

    @Override
    public void update(ImpalaQueryResultWithBLOBs item) {
        impalaQueryResultMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Long id) {
        impalaQueryResultMapper.deleteByPrimaryKey(id);
    }

    @Override
    public ImpalaQueryResultWithBLOBs selectById(Long id) {
        return impalaQueryResultMapper.selectByPrimaryKey(id);
    }

    @Override
    public ImpalaQueryResultWithBLOBs selectByHistoryId(Long historyId) {
        return impalaQueryResultMapper.selectResultByHistoryId(historyId);
    }

}
