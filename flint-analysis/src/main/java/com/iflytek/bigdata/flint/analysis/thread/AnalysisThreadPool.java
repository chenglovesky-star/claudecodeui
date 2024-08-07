package com.iflytek.bigdata.flint.analysis.thread;

import java.util.Map;
import java.util.concurrent.*;

/**
 * 线程池基础类
 */
public class AnalysisThreadPool {

    public final static String HIVE_QUERY_THREAD_NAME = "ImpalaQueryAsyncTaskThread-";

    private final static int POOL_SIZE = 64;

    public static Map<String, Future<?>> activeThreadsMap = new ConcurrentHashMap<String, Future<?>>();    //String为线程名，Future为线程结果

    private static ExecutorService executorService;

    private static ExecutorService getExecutor() {
        if (executorService == null || executorService.isShutdown()) {
            synchronized (ThreadFactory.class) {
                if (executorService == null || executorService.isShutdown()) {
                    executorService = Executors.newFixedThreadPool(POOL_SIZE);
                    activeThreadsMap = new ConcurrentHashMap<String, Future<?>>();
                }
            }
        }
        return executorService;
    }

    /**
     * 手动终止某个线程，并将Future从活跃列表移除
     *
     * @param queryHistId
     */
    public static void stopThread(long queryHistId) {
        if (activeThreadsMap != null) {
            Future<?> result = activeThreadsMap.get(HIVE_QUERY_THREAD_NAME + queryHistId);
            if (result != null) {
                result.cancel(true);
            }
            activeThreadsMap.remove(HIVE_QUERY_THREAD_NAME + queryHistId);
        }
    }

    /**
     * 不返回结果的execute方法
     *
     * @param <T extends Runnable> thread
     */
    public static <T extends Runnable> void execute(T thread) {
        getExecutor().execute(thread);
    }

    public static void executeImpalaQuery(AnalysisQueryTask queryTask) {
        Future<?> result = getExecutor().submit(queryTask);

        //加入活跃线程列表，方便后面取消任务
        if (queryTask != null) {
            activeThreadsMap.put(HIVE_QUERY_THREAD_NAME + queryTask.getQueryHistoryId(), result);
        }
    }


    public static <T> Future<T> submit(Callable<T> task) {
        return getExecutor().submit(task);
    }

    /**
     * 不再使用线程池时，调用该方法关闭线程池即可
     */
    public static final void shutdown() {
        getExecutor().shutdown();
        activeThreadsMap = null;
    }
}
