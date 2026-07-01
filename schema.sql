-- Create a profiles table for ApplyTrack
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  full_name TEXT,
  gmail_connected BOOLEAN DEFAULT false NOT NULL,
  onboarding_completed BOOLEAN DEFAULT false NOT NULL,
  last_synced TIMESTAMP WITH TIME ZONE,
  sync_error BOOLEAN DEFAULT false NOT NULL
);

-- Enable Row Level Security (RLS) on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for profile access
CREATE POLICY "Allow public read access to profiles" 
  ON public.profiles FOR SELECT 
  USING (true);

CREATE POLICY "Allow individual read access to own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Allow individual update access to own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

-- Create a jobs table to store synced application records
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'interview', 'assessment', 'offer', 'rejected')),
  date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  source TEXT,
  recruiter_email TEXT,
  email_subject TEXT,
  confidence_score NUMERIC(5,2) DEFAULT 0.00,
  category TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  -- New columns for Milestone 5
  employment_type TEXT,
  location TEXT,
  salary_range TEXT,
  job_url TEXT,
  recruiter_name TEXT,
  recruiter_linkedin TEXT,
  recruiter_phone TEXT,
  CONSTRAINT unique_user_company_role UNIQUE (user_id, company, role)
);

-- Enable Row Level Security (RLS) on jobs
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Create policies for jobs access
CREATE POLICY "Allow individual read access to own jobs"
  ON public.jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual update access to own jobs"
  ON public.jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own jobs"
  ON public.jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Create a job_notes table to store notes associated with applications
CREATE TABLE IF NOT EXISTS public.job_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on job_notes
ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow individual read access to own job notes"
  ON public.job_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own job notes"
  ON public.job_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual update access to own job notes"
  ON public.job_notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own job notes"
  ON public.job_notes FOR DELETE
  USING (auth.uid() = user_id);

-- Create a job_attachments table to store attachment metadata
CREATE TABLE IF NOT EXISTS public.job_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'resume', 'cover_letter', 'portfolio', 'other'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on job_attachments
ALTER TABLE public.job_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow individual read access to own job attachments"
  ON public.job_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own job attachments"
  ON public.job_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own job attachments"
  ON public.job_attachments FOR DELETE
  USING (auth.uid() = user_id);

-- Create a job_activities table to store historical logs
CREATE TABLE IF NOT EXISTS public.job_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL, -- 'created', 'status_changed', 'note_added', 'attachment_added', 'recruiter_updated', 'details_updated'
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on job_activities
ALTER TABLE public.job_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow individual read access to own job activities"
  ON public.job_activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own job activities"
  ON public.job_activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create a function to automatically insert a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, gmail_connected, onboarding_completed, last_synced, sync_error)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'New User'),
    false,
    false,
    NULL,
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger that runs the function on user creation
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create interviews table to store schedule details
CREATE TABLE IF NOT EXISTS public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  interview_type TEXT NOT NULL CHECK (interview_type IN ('Screening Call', 'HR Interview', 'Technical Interview', 'Portfolio Review', 'Final Interview')),
  date DATE NOT NULL,
  time TIME NOT NULL,
  time_zone TEXT DEFAULT 'UTC' NOT NULL,
  meeting_link TEXT,
  interviewer_name TEXT,
  interviewer_email TEXT,
  notes TEXT,
  status TEXT DEFAULT 'Upcoming' NOT NULL CHECK (status IN ('Upcoming', 'Completed', 'Cancelled')),
  reminders TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on interviews
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

-- Create policies for interviews access
CREATE POLICY "Allow individual read access to own interviews"
  ON public.interviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own interviews"
  ON public.interviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual update access to own interviews"
  ON public.interviews FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own interviews"
  ON public.interviews FOR DELETE
  USING (auth.uid() = user_id);

-- Create saved_views table to store custom user views
CREATE TABLE IF NOT EXISTS public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_user_view_name UNIQUE (user_id, name)
);

-- Enable Row Level Security (RLS) on saved_views
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

-- Create policies for saved_views access
CREATE POLICY "Allow individual read access to own saved views"
  ON public.saved_views FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own saved views"
  ON public.saved_views FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own saved views"
  ON public.saved_views FOR DELETE
  USING (auth.uid() = user_id);

-- ==========================================================================
-- MILESTONE 8: NOTIFICATIONS & FOLLOW-UP CENTER
-- ==========================================================================

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- 'Interview Scheduled', 'Assessment Received', 'Offer Received', 'Application Updated', 'Reminder Due'
  status TEXT DEFAULT 'unread' NOT NULL, -- 'unread', 'read', 'archived'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create policies for notifications access
CREATE POLICY "Allow individual select access to own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual update access to own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Alter jobs table to add follow-up columns
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS follow_up_status TEXT DEFAULT 'none' NOT NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS last_follow_up TIMESTAMP WITH TIME ZONE;

-- ==========================================================================
-- MILESTONE 11: AI RESUME ANALYZER
-- ==========================================================================

-- Create resumes table to store multiple versions
CREATE TABLE IF NOT EXISTS public.resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on resumes
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

-- Create policies for resumes access
CREATE POLICY "Allow individual read access to own resumes"
  ON public.resumes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own resumes"
  ON public.resumes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own resumes"
  ON public.resumes FOR DELETE
  USING (auth.uid() = user_id);

-- Alter jobs table to link a resume version to each application
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL;

-- ==========================================================================
-- MILESTONE 12: AI COVER LETTER GENERATOR
-- ==========================================================================

-- Create cover_letters table to store multiple versions
CREATE TABLE IF NOT EXISTS public.cover_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('Professional', 'Friendly', 'Confident', 'Formal')),
  hiring_manager TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on cover_letters
ALTER TABLE public.cover_letters ENABLE ROW LEVEL SECURITY;

-- Create policies for cover_letters access
CREATE POLICY "Allow individual read access to own cover letters"
  ON public.cover_letters FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own cover letters"
  ON public.cover_letters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own cover letters"
  ON public.cover_letters FOR DELETE
  USING (auth.uid() = user_id);

-- ==========================================================================
-- MILESTONE 13: AI FOLLOW-UP ASSISTANT
-- ==========================================================================

-- Create follow_ups table to store follow-up email drafts
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE,
  scenario TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('Professional', 'Warm', 'Confident', 'Brief')),
  days_since_contact INTEGER,
  suggested_send_date DATE,
  status TEXT DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'sent')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on follow_ups
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- Create policies for follow_ups access
CREATE POLICY "Allow individual read access to own follow ups"
  ON public.follow_ups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own follow ups"
  ON public.follow_ups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own follow ups"
  ON public.follow_ups FOR DELETE
  USING (auth.uid() = user_id);

-- ==========================================================================
-- MILESTONE 14: AI INTERVIEW COACH
-- ==========================================================================

-- Create practice_questions table to store generated questions
CREATE TABLE IF NOT EXISTS public.practice_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.jobs ON DELETE CASCADE,
  interview_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('General', 'Behavioral', 'Technical', 'Company-Specific', 'Portfolio')),
  question TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create practice_answers table to store structured user responses
CREATE TABLE IF NOT EXISTS public.practice_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES public.practice_questions ON DELETE CASCADE NOT NULL,
  situation TEXT,
  task TEXT,
  action TEXT,
  result TEXT,
  full_answer TEXT NOT NULL,
  ai_feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on both tables
ALTER TABLE public.practice_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_answers ENABLE ROW LEVEL SECURITY;

-- Create policies for practice_questions access
CREATE POLICY "Allow individual read access to own practice questions"
  ON public.practice_questions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own practice questions"
  ON public.practice_questions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own practice questions"
  ON public.practice_questions FOR DELETE
  USING (auth.uid() = user_id);

-- Create policies for practice_answers access
CREATE POLICY "Allow individual read access to own practice answers"
  ON public.practice_answers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own practice answers"
  ON public.practice_answers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own practice answers"
  ON public.practice_answers FOR DELETE
  USING (auth.uid() = user_id);

-- ==========================================================================
-- MILESTONE 15: AI JOB SEARCH ADVISOR
-- ==========================================================================

-- Create weekly_reports table to store advisor weekly statistics
CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  content JSONB NOT NULL,
  goals JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) on weekly_reports
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

-- Create policies for weekly_reports access
CREATE POLICY "Allow individual read access to own weekly reports"
  ON public.weekly_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own weekly reports"
  ON public.weekly_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own weekly reports"
  ON public.weekly_reports FOR DELETE
  USING (auth.uid() = user_id);
