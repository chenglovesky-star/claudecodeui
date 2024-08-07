package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

@Data
public class UserDefineRule {
    /**
     * 事件1
     */
    private EventRuleDto first;
    /**
     * 事件2
     */
    private EventRuleDto second;
    /**
     * 自定义指标值
     */
    private String name;
    /**
     * 操作符
     */
    private String operator;
    /**
     * 结果精度
     */
    private String precision;

    private Boolean showUp = true;

    private Boolean edit = false;
}
