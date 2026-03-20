package com.iflytek.bigdata.flint.analysis.service.impl;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.analysis.dao.mapper.ImpalaQueryHistoryMapper;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryExample;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.common.date.DateStyle;
import com.iflytek.bigdata.flint.common.date.DateUtil;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class ImpalaQueryHistoryServiceImpl implements IImpalaQueryHistoryService {

    @Resource
    ImpalaQueryHistoryMapper impalaQueryHistoryMapper;

    @Override
    public List<ImpalaQueryHistoryWithBLOBs> select(ImpalaQueryHistoryWithBLOBs item) {
        ImpalaQueryHistoryExample example = new ImpalaQueryHistoryExample();
        ImpalaQueryHistoryExample.Criteria criteria = example.createCriteria();
        if (StringUtils.isNotEmpty(item.getUsername())) {
            criteria.andUsernameEqualTo(item.getUsername());
        }
        if (item.getStatus() != null) {
            criteria.andStatusEqualTo(item.getStatus());
        }

        if (item.getQuerySql() != null) {
            criteria.andQuerySqlEqualTo(item.getQuerySql());
        }
        if (StringUtils.isNotEmpty(item.getSearchPeriod())) {
            String[] arr = item.getSearchPeriod().split(",");
            criteria.andStartTimeGreaterThanOrEqualTo(DateUtil.StringToDate(arr[0], DateStyle.YYYY_MM_DD_HH_MM_SS));
            criteria.andEndTimeLessThanOrEqualTo(DateUtil.StringToDate(arr[1], DateStyle.YYYY_MM_DD_HH_MM_SS));
        }
        return impalaQueryHistoryMapper.selectByExampleWithBLOBs(example);
    }

    @Override
    public PageInfo<ImpalaQueryHistoryWithBLOBs> selectByPage(ImpalaQueryHistoryWithBLOBs item, int pageNum,
            int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<ImpalaQueryHistoryWithBLOBs> list = select(item);
        PageInfo<ImpalaQueryHistoryWithBLOBs> pageInfo = new PageInfo<>(list);
        return pageInfo;
    }

    @Override
    public void insert(ImpalaQueryHistoryWithBLOBs item) {
        impalaQueryHistoryMapper.insertSelective(item);
    }

    @Override
    public void update(ImpalaQueryHistoryWithBLOBs item) {
        impalaQueryHistoryMapper.updateByPrimaryKeySelective(item);
    }

    @Override
    public void delete(Long id) {
        impalaQueryHistoryMapper.deleteByPrimaryKey(id);
    }

    @Override
    public ImpalaQueryHistoryWithBLOBs selectById(Long id) {
        return impalaQueryHistoryMapper.selectByPrimaryKey(id);
    }

    @Override
    public List<ImpalaQueryHistoryWithBLOBs> selectBySql(String sql) {
        return impalaQueryHistoryMapper.selectBySql(sql);
    }

    @Override
    public ImpalaQueryHistoryWithBLOBs selectStatusAndMessage(Long id) {
        return impalaQueryHistoryMapper.selectStatusAndMessage(id);
    }

}
