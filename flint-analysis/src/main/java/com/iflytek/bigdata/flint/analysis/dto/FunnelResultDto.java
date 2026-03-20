package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

import java.util.List;

/**
 * 漏斗分析结果DTO
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析查询结果
 */
@Data
public class FunnelResultDto {

    /**
     * 漏斗步骤名称
     */
    private List<String> stepNames;

    /**
     * 各步骤的人数/次数
     */
    private List<Long> stepValues;

    /**
     * 各步骤的转化率
     */
    private List<Double> conversionRates;

    /**
     * 时间维度
     */
    private List<String> timeSeries;

    /**
     * 时间序列详细数据（用于趋势图）
     */
    private List<FunnelTimeSeriesDto> timeSeriesData;

    /**
     * 分组维度
     */
    private List<String> groupByFields;

    /**
     * 分组结果数据
     */
    private List<FunnelGroupResultDto> groupResults;

    /**
     * 是否完整数据
     */
    private Boolean full = true;
} 