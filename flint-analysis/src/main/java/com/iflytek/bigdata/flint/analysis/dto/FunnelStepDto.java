package com.iflytek.bigdata.flint.analysis.dto;

import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;
import lombok.Data;

import java.util.List;

/**
 * 漏斗步骤DTO
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析中的单个步骤配置
 */
@Data
public class FunnelStepDto {

    /**
     * 步骤编号
     */
    private Integer stepNumber;

    /**
     * 事件名称
     */
    private String eventName;

    /**
     * 事件别名
     */
    private String eventAlias;

    /**
     * 关联属性
     */
    private List<String> associatedProperties;

    /**
     * 是否同时显示
     */
    private Boolean displaySimultaneously = false;

    /**
     * 筛选条件
     */
    private PropertyFilterDto filter;

    /**
     * 步骤描述
     */
    private String description;
} 