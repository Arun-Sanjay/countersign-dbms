-- =====================================================================
--  Unified Experiential Learning Platform : SAMPLE DATA
--  (Names other than the author's are fictional sample data.)
-- =====================================================================

INSERT INTO student VALUES
('1RV24CY047', 'S Arun Sanjay',  'arun.cy24@rvce.edu.in',    'CSE', 'A', 5, '2024-09-01'),
('1RV24CY011', 'Aditi Rao',      'aditi.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY024', 'Karthik M',      'karthik.cy24@rvce.edu.in', 'CSE', 'A', 5, '2024-09-01'),
('1RV24CY033', 'Meera Iyer',     'meera.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY041', 'Rahul Nair',     'rahul.cy24@rvce.edu.in',   'CSE', 'A', 5, '2024-09-01'),
('1RV24CY052', 'Sneha Patil',    'sneha.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY058', 'Vikram Shetty',  'vikram.cy24@rvce.edu.in',  'CSE', 'B', 5, '2024-09-01'),
('1RV24CY063', 'Priya Menon',    'priya.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY066', 'Rohan Kulkarni', 'rohan.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY071', 'Divya Hegde',    'divya.cy24@rvce.edu.in',   'CSE', 'B', 5, '2024-09-01'),
('1RV24CY077', 'Nikhil Bhat',    'nikhil.cy24@rvce.edu.in',  'CSE', 'B', 5, '2024-09-01'),
('1RV24CY082', 'Ananya Gowda',   'ananya.cy24@rvce.edu.in',  'CSE', 'A', 5, '2024-09-01');

INSERT INTO faculty VALUES
('F01', 'Dr. Ramesh Babu',    'ramesh@rvce.edu.in',  'CSE', 'Professor'),
('F02', 'Dr. Lakshmi Prasad', 'lakshmi@rvce.edu.in', 'CSE', 'Associate Professor'),
('F03', 'Prof. Kavitha S',    'kavitha@rvce.edu.in', 'CSE', 'Assistant Professor'),
('F04', 'Prof. Suresh N',     'suresh@rvce.edu.in',  'CSE', 'Assistant Professor');

INSERT INTO course VALUES
('CD252IA', 'Database Management Systems',                   5, 4, 'F01'),
('CD253IA', 'Artificial Intelligence and Machine Learning',  5, 4, 'F02'),
('CD254TA', 'Operating Systems',                             5, 3, 'F03'),
('CD243AI', 'Analog and Digital Logic Design',               4, 4, 'F04');

INSERT INTO project VALUES
('P01', 'CD252IA', 'DBMS Mini Project',          'Open-ended database mini project',      '2026-09-15', '2026-12-15', 'active'),
('P02', 'CD253IA', 'AIML Experiential Learning', 'Applied ML project with a trained model', '2026-09-20', '2026-12-20', 'active'),
('P03', 'CD254TA', 'OS Mini Project',            'CPU scheduling simulator',              '2026-10-01', '2026-12-10', 'active'),
('P04', 'CD243AI', 'ADLD Hardware Project',      'Digital logic hardware build',          '2026-02-01', '2026-05-15', 'completed'),
('P05', 'CD252IA', 'DBMS Innovative Experiment', 'Concurrency control experiment',        '2026-11-01', '2026-12-15', 'planned');

INSERT INTO team VALUES
('T01', 'P01', 'Team Alpha',   4, '2026-09-18'),
('T02', 'P01', 'Team Beta',    4, '2026-09-19'),
('T03', 'P02', 'Team Gamma',   5, '2026-09-22'),
('T04', 'P03', 'Team Delta',   4, '2026-10-03'),
('T05', 'P04', 'Team Epsilon', 4, '2026-02-03');

INSERT INTO team_member VALUES
('T01', '1RV24CY047', 'lead',   '2026-09-18'),
('T01', '1RV24CY011', 'member', '2026-09-18'),
('T01', '1RV24CY024', 'member', '2026-09-18'),
('T01', '1RV24CY033', 'member', '2026-09-19'),
('T02', '1RV24CY041', 'lead',   '2026-09-19'),
('T02', '1RV24CY052', 'member', '2026-09-19'),
('T02', '1RV24CY058', 'member', '2026-09-20'),
('T03', '1RV24CY063', 'lead',   '2026-09-22'),
('T03', '1RV24CY047', 'member', '2026-09-22'),
('T03', '1RV24CY066', 'member', '2026-09-22'),
('T03', '1RV24CY071', 'member', '2026-09-23'),
('T03', '1RV24CY033', 'member', '2026-09-23'),
('T04', '1RV24CY024', 'lead',   '2026-10-03'),
('T04', '1RV24CY058', 'member', '2026-10-03'),
('T04', '1RV24CY071', 'member', '2026-10-04'),
('T05', '1RV24CY047', 'lead',   '2026-02-03'),
('T05', '1RV24CY011', 'member', '2026-02-03'),
('T05', '1RV24CY041', 'member', '2026-02-03'),
('T05', '1RV24CY063', 'member', '2026-02-04');

INSERT INTO skill VALUES
('S01', 'Databases',        'Core',      NULL),
('S02', 'SQL',              'Core',      'S01'),
('S03', 'NoSQL',            'Core',      'S01'),
('S04', 'Normalization',    'Core',      'S01'),
('S05', 'Transactions',     'Core',      'S02'),
('S06', 'MongoDB',          'Tool',      'S03'),
('S07', 'Programming',      'Core',      NULL),
('S08', 'Python',           'Language',  'S07'),
('S09', 'JavaScript',       'Language',  'S07'),
('S10', 'Machine Learning', 'AI',        NULL),
('S11', 'Deep Learning',    'AI',        'S10'),
('S12', 'Operating Systems','Systems',   NULL),
('S13', 'Digital Logic',    'Hardware',  NULL),
('S14', 'React',            'Framework', 'S09');

INSERT INTO student_skill VALUES
('1RV24CY047','S02',5),('1RV24CY047','S04',4),('1RV24CY047','S05',4),('1RV24CY047','S06',4),
('1RV24CY047','S08',5),('1RV24CY047','S09',4),('1RV24CY047','S10',4),('1RV24CY047','S11',3),
('1RV24CY047','S13',3),('1RV24CY047','S14',4),
('1RV24CY011','S02',4),('1RV24CY011','S04',3),('1RV24CY011','S06',3),('1RV24CY011','S08',4),
('1RV24CY024','S02',3),('1RV24CY024','S08',4),('1RV24CY024','S12',4),
('1RV24CY033','S04',2),('1RV24CY033','S08',3),('1RV24CY033','S10',4),('1RV24CY033','S11',3),
('1RV24CY041','S02',4),('1RV24CY041','S04',4),('1RV24CY041','S06',2),('1RV24CY041','S08',3),('1RV24CY041','S13',3),
('1RV24CY052','S02',3),('1RV24CY052','S09',4),('1RV24CY052','S14',3),
('1RV24CY058','S12',3),('1RV24CY058','S13',4),
('1RV24CY063','S08',5),('1RV24CY063','S10',5),('1RV24CY063','S11',4),('1RV24CY063','S13',3),
('1RV24CY066','S08',4),('1RV24CY066','S10',3),
('1RV24CY071','S08',3),('1RV24CY071','S10',3),('1RV24CY071','S12',4),
('1RV24CY077','S02',4),('1RV24CY077','S04',3),('1RV24CY077','S06',4),('1RV24CY077','S08',3),
('1RV24CY082','S09',3),('1RV24CY082','S14',4);

INSERT INTO project_skill VALUES
('P01','S02'),('P01','S04'),('P01','S06'),('P01','S08'),
('P02','S08'),('P02','S10'),('P02','S11'),
('P03','S08'),('P03','S12'),
('P04','S13'),
('P05','S02'),('P05','S05');

INSERT INTO milestone VALUES
('P01', 1, 'Synopsis',                  5, '2026-10-20'),
('P01', 2, 'Requirement Specification', 5, '2026-10-27'),
('P01', 3, 'ER Diagram',               10, '2026-11-05'),
('P01', 4, 'DFD',                      10, '2026-11-15'),
('P01', 5, 'Normalized Tables',        10, '2026-11-25'),
('P02', 1, 'Proposal',                 10, '2026-10-15'),
('P02', 2, 'Model Training',           20, '2026-11-20'),
('P02', 3, 'Final Report',             20, '2026-12-15'),
('P03', 1, 'Design Document',          10, '2026-10-30'),
('P03', 2, 'Implementation',           20, '2026-12-01'),
('P04', 1, 'Circuit Design',           15, '2026-03-15'),
('P04', 2, 'Final Demo',               15, '2026-05-10'),
('P05', 1, 'Experiment Plan',          10, '2026-11-20');

INSERT INTO artifact VALUES
('A01', 'T01', 'P01', 1, 'Synopsis draft',          'report',  'editor',   '2026-10-12'),
('A02', 'T01', 'P01', 1, 'Literature survey notes', 'note',    'obsidian', '2026-10-08'),
('A03', 'T01', 'P01', 2, 'SRS document',            'report',  'editor',   '2026-10-22'),
('A04', 'T01', 'P01', 3, 'ER diagram',              'diagram', 'editor',   '2026-10-30'),
('A05', 'T01', 'P01', 3, 'Schema DDL',              'code',    'github',   '2026-11-01'),
('A06', 'T02', 'P01', 1, 'Synopsis',                'report',  'editor',   '2026-10-15'),
('A07', 'T02', 'P01', 2, 'Requirements notes',      'note',    'obsidian', '2026-10-25'),
('A08', 'T03', 'P02', 1, 'Project proposal',        'report',  'editor',   '2026-10-10'),
('A09', 'T03', 'P02', 2, 'Training pipeline',       'code',    'github',   '2026-11-02'),
('A10', 'T04', 'P03', 1, 'Scheduler design',        'diagram', 'editor',   '2026-10-25'),
('A11', 'T05', 'P04', 1, 'Circuit schematic',       'diagram', 'editor',   '2026-03-10'),
('A12', 'T05', 'P04', 2, 'Demo slides',             'slides',  'editor',   '2026-05-08');

INSERT INTO contribution VALUES
( 1, '1RV24CY047', 'A01', 'documentation', 'Wrote introduction and proposed system',   '2026-10-10'),
( 2, '1RV24CY011', 'A01', 'research',      'Wrote existing system survey',             '2026-10-11'),
( 3, '1RV24CY047', 'A02', 'research',      'Surveyed data provenance papers',          '2026-10-06'),
( 4, '1RV24CY011', 'A02', 'research',      'Surveyed existing EL tools',               '2026-10-07'),
( 5, '1RV24CY047', 'A03', 'documentation', 'Functional requirements',                  '2026-10-20'),
( 6, '1RV24CY011', 'A03', 'documentation', 'Non-functional requirements',              '2026-10-21'),
( 7, '1RV24CY047', 'A04', 'design',        'Entities and relationships',               '2026-10-28'),
( 8, '1RV24CY011', 'A04', 'review',        'Reviewed cardinalities',                   '2026-10-29'),
( 9, '1RV24CY024', 'A04', 'design',        'Added weak entity MILESTONE',              '2026-10-30'),
(10, '1RV24CY047', 'A05', 'code',          'CREATE TABLE scripts',                     '2026-10-31'),
(11, '1RV24CY024', 'A05', 'code',          'Constraints and foreign keys',             '2026-11-01'),
(12, '1RV24CY041', 'A06', 'documentation', 'Full synopsis',                            '2026-10-14'),
(13, '1RV24CY052', 'A06', 'review',        'Proofread synopsis',                       '2026-10-15'),
(14, '1RV24CY041', 'A07', 'research',      'Requirement gathering notes',              '2026-10-24'),
(15, '1RV24CY063', 'A08', 'documentation', 'Proposal write-up',                        '2026-10-09'),
(16, '1RV24CY071', 'A08', 'research',      'Dataset survey',                           '2026-10-08'),
(17, '1RV24CY033', 'A08', 'research',      'Baseline model survey',                    '2026-10-08'),
(18, '1RV24CY063', 'A09', 'code',          'Data loader and model',                    '2026-10-30'),
(19, '1RV24CY066', 'A09', 'code',          'Training loop and early stopping',         '2026-11-01'),
(20, '1RV24CY047', 'A09', 'review',        'Code review of training loop',             '2026-11-02'),
(21, '1RV24CY024', 'A10', 'design',        'Scheduler state diagram',                  '2026-10-23'),
(22, '1RV24CY058', 'A10', 'design',        'Queue design',                             '2026-10-24'),
(23, '1RV24CY071', 'A10', 'review',        'Reviewed design',                          '2026-10-25'),
(24, '1RV24CY047', 'A11', 'design',        'Counter circuit',                          '2026-03-08'),
(25, '1RV24CY011', 'A11', 'design',        'Decoder circuit',                          '2026-03-09'),
(26, '1RV24CY063', 'A11', 'review',        'Verified truth tables',                    '2026-03-10'),
(27, '1RV24CY047', 'A12', 'documentation', 'Demo slides',                              '2026-05-07'),
(28, '1RV24CY041', 'A12', 'documentation', 'Results slides',                           '2026-05-08');

INSERT INTO artifact_chunk VALUES
(1, 'A01', 1, '1RV24CY047', 'The platform unifies every experiential learning project into one system of record.', '2026-10-10'),
(2, 'A01', 2, '1RV24CY011', 'Existing EL work is scattered across WhatsApp groups, Drive and personal GitHub accounts.', '2026-10-11'),
(3, 'A02', 1, '1RV24CY047', 'Data provenance research tracks where each record came from and who changed it.', '2026-10-06'),
(4, 'A04', 1, '1RV24CY047', 'TEAM_MEMBER resolves the many-to-many relationship between STUDENT and TEAM.', '2026-10-28'),
(5, 'A04', 2, '1RV24CY024', 'MILESTONE is a weak entity identified by project_id and milestone_no.', '2026-10-30'),
(6, 'A05', 1, '1RV24CY024', 'Foreign keys use ON DELETE CASCADE for dependent rows.', '2026-11-01'),
(7, 'A09', 1, '1RV24CY066', 'Training loop uses early stopping on validation loss.', '2026-11-01');
