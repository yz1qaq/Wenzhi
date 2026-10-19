// 本目录是独立面试练习，未宣称来自用户生产项目。
package interviewexamples

import (
	"container/list"
	"errors"
	"strconv"
	"strings"
	"sync"
)

// Queue 的零值可用；一个锁覆盖检查、搬运、弹出。
type Queue struct {
	mu      sync.Mutex
	in, out []int
}

func (q *Queue) Enqueue(v int) { q.mu.Lock(); defer q.mu.Unlock(); q.in = append(q.in, v) }
func (q *Queue) Dequeue() (int, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.out) == 0 {
		for len(q.in) > 0 {
			i := len(q.in) - 1
			q.out = append(q.out, q.in[i])
			q.in = q.in[:i]
		}
	}
	if len(q.out) == 0 {
		return 0, false
	}
	i := len(q.out) - 1
	v := q.out[i]
	q.out = q.out[:i]
	return v, true
}

type pair struct{ key, value int }

// LRU 的 Get 也会修改访问顺序，需同步。
type LRU struct {
	mu       sync.Mutex
	capacity int
	order    *list.List
	items    map[int]*list.Element
}

func NewLRU(capacity int) *LRU {
	if capacity < 0 {
		capacity = 0
	}
	return &LRU{capacity: capacity, order: list.New(), items: make(map[int]*list.Element)}
}
func (c *LRU) Get(key int) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[key]; ok {
		c.order.MoveToFront(e)
		return e.Value.(pair).value, true
	}
	return 0, false
}
func (c *LRU) Put(key, value int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.capacity == 0 {
		return
	}
	if e, ok := c.items[key]; ok {
		e.Value = pair{key, value}
		c.order.MoveToFront(e)
		return
	}
	c.items[key] = c.order.PushFront(pair{key, value})
	if len(c.items) > c.capacity {
		e := c.order.Back()
		delete(c.items, e.Value.(pair).key)
		c.order.Remove(e)
	}
}

type TreeNode struct {
	Val         int
	Left, Right *TreeNode
}

func Serialize(root *TreeNode) string {
	var ts []string
	var walk func(*TreeNode)
	walk = func(n *TreeNode) {
		if n == nil {
			ts = append(ts, "#")
			return
		}
		ts = append(ts, strconv.Itoa(n.Val))
		walk(n.Left)
		walk(n.Right)
	}
	walk(root)
	return strings.Join(ts, ",")
}

// 教学递归版；不可信生产输入还应限制长度与递归深度。
func Deserialize(s string) (*TreeNode, error) {
	ts := strings.Split(s, ",")
	i := 0
	var parse func() (*TreeNode, error)
	parse = func() (*TreeNode, error) {
		if i >= len(ts) {
			return nil, errors.New("truncated")
		}
		v := ts[i]
		i++
		if v == "#" {
			return nil, nil
		}
		n, e := strconv.Atoi(v)
		if e != nil {
			return nil, errors.New("invalid value")
		}
		l, e := parse()
		if e != nil {
			return nil, e
		}
		r, e := parse()
		if e != nil {
			return nil, e
		}
		return &TreeNode{n, l, r}, nil
	}
	n, e := parse()
	if e != nil {
		return nil, e
	}
	if i != len(ts) {
		return nil, errors.New("extra tokens")
	}
	return n, nil
}

type ListNode struct {
	Val  int
	Next *ListNode
}

// 非法 k 返回原链表与错误，先验证再修改。
func RemoveNthFromEnd(h *ListNode, k int) (*ListNode, error) {
	if k <= 0 {
		return h, errors.New("k must be positive")
	}
	d := &ListNode{Next: h}
	fast, slow := d, d
	for i := 0; i < k; i++ {
		fast = fast.Next
		if fast == nil {
			return h, errors.New("k exceeds length")
		}
	}
	for fast.Next != nil {
		fast = fast.Next
		slow = slow.Next
	}
	slow.Next = slow.Next.Next
	return d.Next, nil
}

// 按题设仅支持 ASCII 小写字母，使用码点字典序。
func SmallestUniqueLetters(s string) (string, error) {
	var remaining [26]int
	var present [26]bool
	for i := 0; i < len(s); i++ {
		if s[i] < 'a' || s[i] > 'z' {
			return "", errors.New("a-z only")
		}
		remaining[s[i]-'a']++
	}
	stack := make([]byte, 0, 26)
	for i := 0; i < len(s); i++ {
		c := s[i]
		remaining[c-'a']--
		if present[c-'a'] {
			continue
		}
		for len(stack) > 0 {
			top := stack[len(stack)-1]
			if top <= c || remaining[top-'a'] == 0 {
				break
			}
			stack = stack[:len(stack)-1]
			present[top-'a'] = false
		}
		stack = append(stack, c)
		present[c-'a'] = true
	}
	return string(stack), nil
}

// 对应仓库原题的精确输出，包括最后的 2728；两个协程都被等待。
func AlternateNumbersLetters() string {
	number, letter := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup
	var out strings.Builder
	wg.Add(2)
	go func() {
		defer wg.Done()
		for g := 0; g < 14; g++ {
			<-number
			out.WriteString(strconv.Itoa(2*g + 1))
			out.WriteString(strconv.Itoa(2*g + 2))
			if g < 13 {
				letter <- struct{}{}
			}
		}
	}()
	go func() {
		defer wg.Done()
		for g := 0; g < 13; g++ {
			<-letter
			out.WriteByte(byte('A' + 2*g))
			out.WriteByte(byte('A' + 2*g + 1))
			number <- struct{}{}
		}
	}()
	number <- struct{}{}
	wg.Wait()
	return out.String()
}
