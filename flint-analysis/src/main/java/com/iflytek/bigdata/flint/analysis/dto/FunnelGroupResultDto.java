package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

import java.util.List;

/**
 * 漏斗分析分组结果DTO
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析中按分组维度的结果数据
 */
@Data
public class FunnelGroupResultDto {

    /**
     * 分组值
     */
    private List<String> groupValues;

    /**
     * 各步骤的人数/次数
     */
    private List<Long> stepValues;

    /**
     * 各步骤的转化率
     */
    private List<Double> conversionRates;
} 