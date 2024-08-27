package com.iflytek.bigdata.flint.analysis.controller;

/**
 * @Author: linlong
 * @Date: 2024/8/20
 * @Desc:
 */

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ProbeController {
    @GetMapping("probe")
    public String liveness() {
        return "success_20240827";
    }
}
