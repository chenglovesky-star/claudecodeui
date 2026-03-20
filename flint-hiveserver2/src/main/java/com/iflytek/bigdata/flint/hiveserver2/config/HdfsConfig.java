package com.iflytek.bigdata.flint.hiveserver2.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

@org.springframework.context.annotation.Configuration
public class HdfsConfig {

    @Value("${defaultFS:defaultFS}")
    private String defaultFS;

    @Value("${nameservices:nameservices}")
    private String nameservices;

    @Value("${namenode1:namenode1}")
    private String namenode1;

    @Value("${namenode2:namenode2}")
    private String namenode2;

//    @Bean(name = "conf")
//    public Configuration getConf() {
//        Configuration conf = new Configuration();
//        conf.set("dfs.client.block.write.replace-datanode-on-failure.enable", "true");
//        conf.set("dfs.client.block.write.replace-datanode-on-failure.policy", "NEVER");
//        conf.set("fs.trash.interval", "360");
//        conf.set("fs.defaultFS", defaultFS);
//        conf.set("dfs.nameservices", nameservices);
//        conf.set("dfs.ha.namenodes." + nameservices, "nn1,nn2");
//        conf.set("dfs.namenode.rpc-address." + nameservices + ".nn1", namenode1 + ":8020");
//        conf.set("dfs.namenode.rpc-address." + nameservices + ".nn2", namenode2 + ":8020");
//        conf.set("dfs.client.failover.proxy.provider." + nameservices,
//                "org.apache.hadoop.hdfs.server.namenode.ha.ConfiguredFailoverProxyProvider");
//        return conf;
//    }
}
