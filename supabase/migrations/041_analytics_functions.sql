-- ============================================
-- SECURE ANALYTICS RPC FUNCTIONS (SOURCE: AUTH.USERS)
-- ============================================

-- Function to check admin access (reusing existing one but good to be explicit in these functions)
-- NOTE: We assume is_admin_user(email) already exists from 037_create_admin_users.sql

-- ============================================
-- 1. USER GROWTH DYNAMICS
-- ============================================

CREATE OR REPLACE FUNCTION get_user_growth_chart(
  days_back INT DEFAULT 90
)
RETURNS TABLE (
  date DATE,
  new_users BIGINT,
  new_premium BIGINT,
  total_users BIGINT,
  total_premium BIGINT,
  conversion_rate NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH daily_stats AS (
    SELECT 
      DATE(created_at) as _date,
      COUNT(*) as _new_users
    FROM auth.users
    WHERE created_at >= CURRENT_DATE - days_back
    GROUP BY DATE(created_at)
  ),
  premium_stats AS (
    SELECT 
      DATE(ue.created_at) as _date,
      COUNT(*) as _new_premium
    FROM user_entitlements ue
    WHERE ue.is_premium 
      AND ue.created_at >= CURRENT_DATE - days_back
    GROUP BY DATE(ue.created_at)
  )
  SELECT 
    d._date as date,
    d._new_users as new_users,
    COALESCE(p._new_premium, 0) as new_premium,
    SUM(d._new_users) OVER (ORDER BY d._date)::BIGINT as total_users,
    SUM(COALESCE(p._new_premium, 0)) OVER (ORDER BY d._date)::BIGINT as total_premium,
    ROUND(
      (SUM(COALESCE(p._new_premium, 0)) OVER (ORDER BY d._date)::FLOAT / 
       NULLIF(SUM(d._new_users) OVER (ORDER BY d._date), 0) * 100)::numeric, 
      2
    ) as conversion_rate
  FROM daily_stats d
  LEFT JOIN premium_stats p ON d._date = p._date
  ORDER BY d._date;
END;
$$ LANGUAGE plpgsql;

-- 1.2 Current KPI Growth
CREATE OR REPLACE FUNCTION get_growth_kpis()
RETURNS TABLE (
  total_users BIGINT,
  total_premium BIGINT,
  conversion_rate NUMERIC,
  new_users_today BIGINT,
  new_users_this_week BIGINT,
  new_users_this_month BIGINT,
  new_premium_today BIGINT,
  new_premium_this_week BIGINT,
  new_premium_this_month BIGINT,
  growth_rate_month NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT 
      COUNT(*) as _total_users,
      COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as _new_today,
      COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as _new_week,
      COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as _new_month,
      COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '60 days' 
                 AND created_at < CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as _prev_month
    FROM auth.users
  ),
  premium_stats AS (
    SELECT 
      COUNT(*) as _total_premium,
      COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as _new_today,
      COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as _new_week,
      COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as _new_month
    FROM user_entitlements
    WHERE is_premium
  )
  SELECT 
    s._total_users::BIGINT,
    p._total_premium::BIGINT,
    ROUND((p._total_premium::FLOAT / NULLIF(s._total_users, 0) * 100)::numeric, 2) as conversion_rate,
    s._new_today::BIGINT as new_users_today,
    s._new_week::BIGINT as new_users_this_week,
    s._new_month::BIGINT as new_users_this_month,
    p._new_today::BIGINT as new_premium_today,
    p._new_week::BIGINT as new_premium_this_week,
    p._new_month::BIGINT as new_premium_this_month,
    ROUND(((s._new_month::FLOAT / NULLIF(s._prev_month, 0) - 1) * 100)::numeric, 2) as growth_rate_month
  FROM stats s, premium_stats p;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. NEW USERS AND CONVERSION
-- ============================================

CREATE OR REPLACE FUNCTION get_new_users_chart(
  days_back INT DEFAULT 30
)
RETURNS TABLE (
  date DATE,
  new_users BIGINT,
  new_premium BIGINT,
  conversion_rate NUMERIC,
  avg_days_to_premium NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH new_users_daily AS (
    SELECT 
      DATE(au.created_at) as _signup_date,
      au.id as user_id,
      au.created_at
    FROM auth.users au
    WHERE au.created_at >= CURRENT_DATE - days_back
  ),
  conversions AS (
    SELECT 
      nu._signup_date,
      COUNT(*) as _new_users,
      COUNT(CASE WHEN ue.is_premium THEN 1 END) as _new_premium,
      AVG(CASE 
        WHEN ue.is_premium THEN 
          EXTRACT(EPOCH FROM (ue.created_at - nu.created_at)) / 86400 
        ELSE NULL 
      END) as _avg_days_to_premium
    FROM new_users_daily nu
    LEFT JOIN user_entitlements ue ON nu.user_id = ue.user_id
    GROUP BY nu._signup_date
  )
  SELECT 
    c._signup_date as date,
    c._new_users::BIGINT as new_users,
    c._new_premium::BIGINT as new_premium,
    ROUND((c._new_premium::FLOAT / NULLIF(c._new_users, 0) * 100)::numeric, 2) as conversion_rate,
    ROUND(c._avg_days_to_premium::numeric, 1) as avg_days_to_premium
  FROM conversions c
  ORDER BY c._signup_date DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. USER SEGMENTATION
-- ============================================

CREATE OR REPLACE FUNCTION get_user_segments()
RETURNS TABLE (
  segment TEXT,
  user_count BIGINT,
  premium_count BIGINT,
  percentage NUMERIC,
  premium_percentage NUMERIC,
  avg_lessons NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH user_activity AS (
    SELECT 
      user_id,
      COUNT(DISTINCT DATE(updated_at)) as active_days_last_7,
      MAX(updated_at) as last_activity,
      COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as lessons_completed
    FROM lesson_progress
    WHERE updated_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY user_id
  ),
  user_segments_cte AS (
    SELECT 
      au.id as user_id,
      au.created_at,
      COALESCE(ua.active_days_last_7, 0) as active_days,
      COALESCE(ua.last_activity, au.last_sign_in_at) as last_activity,
      COALESCE(ua.lessons_completed, 0) as lessons_completed,
      ue.is_premium,
      CASE 
        -- Daily Learners: 6-7 days of last 7
        WHEN COALESCE(ua.active_days_last_7, 0) >= 6 THEN 'Daily Learner'
        -- Regular Learners: 2-5 days of last 7
        WHEN COALESCE(ua.active_days_last_7, 0) BETWEEN 2 AND 5 THEN 'Regular Learner'
        -- Occasional Learners: 1 day of last 7 OR activity in last 30 days
        WHEN COALESCE(ua.active_days_last_7, 0) = 1 THEN 'Occasional Learner'
        WHEN COALESCE(ua.last_activity, au.last_sign_in_at) >= CURRENT_DATE - INTERVAL '30 days' THEN 'Occasional Learner'
        -- Inactive: no activity 30+ days
        ELSE 'Inactive'
      END as _segment
    FROM auth.users au
    LEFT JOIN user_activity ua ON au.id = ua.user_id
    LEFT JOIN user_entitlements ue ON au.id = ue.user_id
  )
  SELECT 
    us._segment as segment,
    COUNT(*)::BIGINT as user_count,
    COUNT(CASE WHEN us.is_premium THEN 1 END)::BIGINT as premium_count,
    ROUND(((COUNT(*)::FLOAT / NULLIF(SUM(COUNT(*)) OVER (), 0)) * 100)::numeric, 2) as percentage,
    ROUND(((COUNT(CASE WHEN us.is_premium THEN 1 END)::FLOAT / NULLIF(COUNT(*), 0)) * 100)::numeric, 2) as premium_percentage,
    ROUND(AVG(us.lessons_completed)::numeric, 2) as avg_lessons
  FROM user_segments_cte us
  GROUP BY us._segment
  ORDER BY 
    CASE us._segment
      WHEN 'Daily Learner' THEN 1
      WHEN 'Regular Learner' THEN 2
      WHEN 'Occasional Learner' THEN 3
      WHEN 'Inactive' THEN 4
      ELSE 5
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. DAU/WAU/MAU AND ENGAGEMENT
-- ============================================

CREATE OR REPLACE FUNCTION get_engagement_metrics()
RETURNS TABLE (
  dau BIGINT,
  wau BIGINT,
  mau BIGINT,
  dau_mau_ratio NUMERIC,
  wau_mau_ratio NUMERIC,
  stickiness_score TEXT
) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH metrics_cte AS (
    SELECT 
      COUNT(DISTINCT CASE WHEN updated_at >= CURRENT_DATE THEN user_id END) as _dau,
      COUNT(DISTINCT CASE WHEN updated_at >= CURRENT_DATE - INTERVAL '7 days' THEN user_id END) as _wau,
      COUNT(DISTINCT CASE WHEN updated_at >= CURRENT_DATE - INTERVAL '30 days' THEN user_id END) as _mau
    FROM lesson_progress
  )
  SELECT 
    mc._dau::BIGINT as dau,
    mc._wau::BIGINT as wau,
    mc._mau::BIGINT as mau,
    ROUND((mc._dau::FLOAT / NULLIF(mc._mau, 0) * 100)::numeric, 2) as dau_mau_ratio,
    ROUND((mc._wau::FLOAT / NULLIF(mc._mau, 0) * 100)::numeric, 2) as wau_mau_ratio,
    CASE 
      WHEN (mc._dau::FLOAT / NULLIF(mc._mau, 0) * 100) > 20 THEN 'Excellent'
      WHEN (mc._dau::FLOAT / NULLIF(mc._mau, 0) * 100) > 10 THEN 'Good'
      ELSE 'Needs Improvement'
    END as stickiness_score
  FROM metrics_cte mc;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_engagement_chart(
  days_back INT DEFAULT 90
)
RETURNS TABLE (
  date DATE,
  dau BIGINT,
  wau BIGINT,
  mau BIGINT,
  dau_mau_ratio NUMERIC
) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - days_back,
      CURRENT_DATE,
      '1 day'::interval
    )::date as _date
  ),
  daily_metrics AS (
    SELECT 
      d._date,
      COUNT(DISTINCT CASE WHEN lp.updated_at >= d._date AND lp.updated_at < d._date + INTERVAL '1 day' 
                          THEN lp.user_id END) as _dau,
      COUNT(DISTINCT CASE WHEN lp.updated_at >= d._date - INTERVAL '6 days' AND lp.updated_at <= d._date 
                          THEN lp.user_id END) as _wau,
      COUNT(DISTINCT CASE WHEN lp.updated_at >= d._date - INTERVAL '29 days' AND lp.updated_at <= d._date 
                          THEN lp.user_id END) as _mau
    FROM date_series d
    LEFT JOIN lesson_progress lp ON lp.updated_at >= d._date - INTERVAL '29 days' AND lp.updated_at <= d._date + INTERVAL '1 day'
    GROUP BY d._date
  )
  SELECT 
    dm._date as date,
    dm._dau::BIGINT as dau,
    dm._wau::BIGINT as wau,
    dm._mau::BIGINT as mau,
    ROUND((dm._dau::FLOAT / NULLIF(dm._mau, 0) * 100)::numeric, 2) as dau_mau_ratio
  FROM daily_metrics dm
  ORDER BY dm._date;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. RETENTION
-- ============================================

CREATE OR REPLACE FUNCTION get_retention_metrics()
RETURNS TABLE (
  signup_date DATE,
  total_users BIGINT,
  day_1_retained BIGINT,
  day_7_retained BIGINT,
  day_30_retained BIGINT,
  day_1_retention_pct NUMERIC,
  day_7_retention_pct NUMERIC,
  day_30_retention_pct NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH user_cohorts AS (
    SELECT 
      id as user_id,
      DATE(created_at) as _signup_date
    FROM auth.users
    WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
  ),
  user_activity AS (
    SELECT 
      user_id,
      DATE(updated_at) as activity_date
    FROM lesson_progress
  )
  SELECT 
    uc._signup_date as signup_date,
    COUNT(DISTINCT uc.user_id)::BIGINT as total_users,
    COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 1 THEN uc.user_id END)::BIGINT as day_1_retained,
    COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 7 THEN uc.user_id END)::BIGINT as day_7_retained,
    COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 30 THEN uc.user_id END)::BIGINT as day_30_retained,
    ROUND((COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 1 THEN uc.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT uc.user_id), 0) * 100)::numeric, 2) as day_1_retention_pct,
    ROUND((COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 7 THEN uc.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT uc.user_id), 0) * 100)::numeric, 2) as day_7_retention_pct,
    ROUND((COUNT(DISTINCT CASE WHEN ua.activity_date = uc._signup_date + 30 THEN uc.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT uc.user_id), 0) * 100)::numeric, 2) as day_30_retention_pct
  FROM user_cohorts uc
  LEFT JOIN user_activity ua ON uc.user_id = ua.user_id
  WHERE uc._signup_date >= CURRENT_DATE - INTERVAL '60 days'
  GROUP BY uc._signup_date
  ORDER BY uc._signup_date DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_cohort_retention()
RETURNS TABLE (
  cohort_month DATE,
  cohort_size BIGINT,
  month_0 BIGINT,
  month_1 BIGINT,
  month_2 BIGINT,
  month_3 BIGINT,
  month_0_pct NUMERIC,
  month_1_pct NUMERIC,
  month_2_pct NUMERIC,
  month_3_pct NUMERIC
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH cohorts AS (
    SELECT 
      id as user_id,
      DATE_TRUNC('month', created_at)::date as _cohort_month
    FROM auth.users
    WHERE created_at >= CURRENT_DATE - INTERVAL '6 months'
  ),
  activity AS (
    SELECT 
      user_id,
      DATE_TRUNC('month', updated_at)::date as activity_month
    FROM lesson_progress
  )
  SELECT 
    c._cohort_month as cohort_month,
    COUNT(DISTINCT c.user_id)::BIGINT as cohort_size,
    COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month THEN c.user_id END)::BIGINT as month_0,
    COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '1 month' THEN c.user_id END)::BIGINT as month_1,
    COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '2 months' THEN c.user_id END)::BIGINT as month_2,
    COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '3 months' THEN c.user_id END)::BIGINT as month_3,
    ROUND((COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month THEN c.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT c.user_id), 0) * 100)::numeric, 2) as month_0_pct,
    ROUND((COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '1 month' THEN c.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT c.user_id), 0) * 100)::numeric, 2) as month_1_pct,
    ROUND((COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '2 months' THEN c.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT c.user_id), 0) * 100)::numeric, 2) as month_2_pct,
    ROUND((COUNT(DISTINCT CASE WHEN a.activity_month = c._cohort_month + INTERVAL '3 months' THEN c.user_id END)::NUMERIC / 
      NULLIF(COUNT(DISTINCT c.user_id), 0) * 100)::numeric, 2) as month_3_pct
  FROM cohorts c
  LEFT JOIN activity a ON c.user_id = a.user_id
  GROUP BY c._cohort_month
  ORDER BY c._cohort_month DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. ALL-IN-ONE DASHBOARD DATA
-- ============================================

CREATE OR REPLACE FUNCTION get_dashboard_kpis()
RETURNS JSON
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Security Check
  IF NOT is_admin_user((auth.jwt()->>'email')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN json_build_object(
    'growth', (SELECT row_to_json(r) FROM (SELECT * FROM get_growth_kpis()) r),
    'engagement', (SELECT row_to_json(r) FROM (SELECT * FROM get_engagement_metrics()) r),
    'segments', (SELECT json_agg(row_to_json(r)) FROM (SELECT * FROM get_user_segments()) r)
  );
END;
$$ LANGUAGE plpgsql;

-- Grant access to authenticated users (they still need to pass the check inside)
GRANT EXECUTE ON FUNCTION get_user_growth_chart(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_growth_kpis() TO authenticated;
GRANT EXECUTE ON FUNCTION get_new_users_chart(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_segments() TO authenticated;
GRANT EXECUTE ON FUNCTION get_engagement_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_engagement_chart(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_retention_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_cohort_retention() TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_kpis() TO authenticated;
