package com.iflytek.bigdata.flint.analysis.service.impl;

import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dto.FunnelAnalysisDto;
import com.iflytek.bigdata.flint.analysis.dto.FunnelResultDto;
import com.iflytek.bigdata.flint.analysis.dto.FunnelStepDto;
import com.iflytek.bigdata.flint.analysis.service.IFunnelAnalysisService;
import com.iflytek.bigdata.flint.analysis.utils.FunnelAnalysisUtil;
import com.iflytek.bigdata.flint.common.dto.Response;
import lombok.extern.log4j.Log4j2;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;

/**
 * 漏斗分析Service实现类
 * @Author: xuhao
 * @Date: 2025/1/27
 * @Desc: 漏斗分析业务逻辑实现
 */
@Service
@Log4j2
public class FunnelAnalysisServiceImpl implements IFunnelAnalysisService {

    @Resource
    private FunnelAnalysisUtil funnelAnalysisUtil;

    @Override
    public ImpalaQueryHistory createFunnelQuery(String operator, FunnelAnalysisDto funnelAnalysisDto, Integer cache) {
        // 参数验证
        if (!validateFunnelAnalysisParams(funnelAnalysisDto)) {
            throw new IllegalArgumentException("漏斗分析参数验证失败");
        }
        
        // 调用工具类创建查询
        return funnelAnalysisUtil.createFunnelQuery(operator, funnelAnalysisDto, cache);
    }

    @Override
    public FunnelResultDto getFunnelResultByHistoryId(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("查询历史ID不能为空");
        }
        
        // 调用工具类获取结果
        return funnelAnalysisUtil.getFunnelResultByHistoryId(id);
    }

    @Override
    public boolean validateFunnelAnalysisParams(FunnelAnalysisDto funnelAnalysisDto) {
        if (funnelAnalysisDto == null) {
            log.error("漏斗分析参数为空");
            return false;
        }
        
        // 验证时间参数
        if (StringUtils.isEmpty(funnelAnalysisDto.getTimeValues())) {
            log.error("时间参数不能为空");
            return false;
        }
        
        // 验证漏斗步骤
        if (CollectionUtils.isEmpty(funnelAnalysisDto.getFunnelSteps())) {
            log.error("漏斗步骤不能为空");
            return false;
        }
        
        // 验证每个步骤
        for (int i = 0; i < funnelAnalysisDto.getFunnelSteps().size(); i++) {
            FunnelStepDto step = funnelAnalysisDto.getFunnelSteps().get(i);
            if (step == null) {
                log.error("第{}步为空", i + 1);
                return false;
            }
            
            if (StringUtils.isEmpty(step.getEventName())) {
                log.error("第{}步事件名称不能为空", i + 1);
                return false;
            }
            
            // 设置步骤编号
            step.setStepNumber(i + 1);
        }
        
        // 验证窗口期
        if (funnelAnalysisDto.getWindowPeriod() != null && funnelAnalysisDto.getWindowPeriod() <= 0) {
            log.error("窗口期必须大于0");
            return false;
        }
        
        // 验证时间粒度
        if (funnelAnalysisDto.getTimeBucket() != null && 
            (funnelAnalysisDto.getTimeBucket() < 0 || funnelAnalysisDto.getTimeBucket() > 5)) {
            log.error("时间粒度参数无效");
            return false;
        }
        
        return true;
    }

    @Override
    public List<Double> calculateConversionRates(List<Long> stepValues) {
        if (CollectionUtils.isEmpty(stepValues)) {
            return new ArrayList<>();
        }
        
        List<Double> conversionRates = new ArrayList<>();
        
        for (int i = 0; i < stepValues.size(); i++) {
            if (i == 0) {
                // 第一步转化率为100%
                conversionRates.add(100.0);
            } else {
                // 计算后续步骤的转化率
                Long previousValue = stepValues.get(i - 1);
                Long currentValue = stepValues.get(i);
                
                if (previousValue != null && previousValue > 0 && currentValue != null) {
                    double rate = (double) currentValue / previousValue * 100;
                    // 保留两位小数
                    conversionRates.add(Math.round(rate * 100.0) / 100.0);
                } else {
                    conversionRates.add(0.0);
                }
            }
        }
        
        return conversionRates;
    }

    @Override
    public String generateFunnelSqlExample(FunnelAnalysisDto funnelAnalysisDto) {
        // 参数验证
        if (!validateFunnelAnalysisParams(funnelAnalysisDto)) {
            throw new IllegalArgumentException("漏斗分析参数验证失败");
        }
        
        // 调用工具类生成SQL
        return funnelAnalysisUtil.generateFunnelSqlExample(funnelAnalysisDto);
    }
} 