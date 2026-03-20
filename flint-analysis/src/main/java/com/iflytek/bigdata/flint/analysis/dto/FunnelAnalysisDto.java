package com.iflytek.bigdata.flint.analysis.dto;

import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;
import lombok.Data;

import java.util.List;

/**
 * 漏斗分析DTO
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析请求参数
 */
@Data
public class FunnelAnalysisDto {

    private Long id;

    /**
     * 漏斗类型：0-按人数分析，1-按次数分析
     */
    private Integer funnelType = 0;

    /**
     * 窗口期（天数）
     */
    private Integer windowPeriod = 7;

    /**
     * 时间窗口类型：0-自定义天数，1-首日，2-次日
     */
    private Integer windowType = 0;

    /**
     * 漏斗步骤配置
     */
    private List<FunnelStepDto> funnelSteps;

    /**
     * 全局筛选条件
     */
    private PropertyFilterDto globalFilter;

    /**
     * 分组选择
     */
    private List<String> groupBy;

    /**
     * 时间选择
     */
    private String timeValues;

    /**
     * 时间粒度：0-按天，1-按小时，2-按分钟，3-按周，4-按月，5-累计
     */
    private Integer timeBucket = 0;

    /**
     * 是否刷新缓存：0-刷新，1-不刷新
     */
    private Integer cache = 1;
} 