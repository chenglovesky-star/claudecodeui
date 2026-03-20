package com.iflytek.bigdata.flint.analysis.thread;

/**
 * query_history表status字段的枚举值
 */
public enum AnalysisQueryStatusEnum {
    FINISHED(0, "已运行完毕"), RUNNING(1, "任务执行中"), ABORTED(2, "已经被取消"), ERROR(3, "运行出现错误");

    private int index;

    private String name;

    private AnalysisQueryStatusEnum(int index, String name) {
        this.index = index;
        this.name = name;
    }

    public String getName() {
        return this.name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getIndex() {
        return this.index;
    }

    public void setIndex(int index) {
        this.index = index;
    }

}
