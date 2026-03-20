package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

import java.util.List;

/**
 * 漏斗分析时间序列数据DTO
 * @Author: xuhao
 * @Date: 2025/10/10
 * @Desc: 漏斗分析按时间维度的详细数据（用于趋势图）
 */
@Data
public class FunnelTimeSeriesDto {

    /**
     * 时间点（如：20251003、2025-10-03 10:00等）
     */
    private String timePoint;

    /**
     * 各步骤的人数/次数
     */
    private List<Long> stepValues;

    /**
     * 各步骤的转化率
     */
    private List<Double> conversionRates;
}

