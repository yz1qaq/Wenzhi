package interviewexamples

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestQueueFIFO(t *testing.T) {
	var q Queue
	if _, ok := q.Dequeue(); ok {
		t.Fatal("empty")
	}
	q.Enqueue(1)
	q.Enqueue(2)
	v, _ := q.Dequeue()
	if v != 1 {
		t.Fatal(v)
	}
	q.Enqueue(3)
	for _, w := range []int{2, 3} {
		v, ok := q.Dequeue()
		if !ok || v != w {
			t.Fatal(v, ok)
		}
	}
}
func TestQueueConcurrentNoLoss(t *testing.T) {
	var q Queue
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				q.Enqueue(n*100 + i)
			}
		}(n)
	}
	wg.Wait()
	seen := map[int]bool{}
	for {
		v, ok := q.Dequeue()
		if !ok {
			break
		}
		if seen[v] {
			t.Fatal("duplicate")
		}
		seen[v] = true
	}
	if len(seen) != 800 {
		t.Fatal(len(seen))
	}
}
func TestLRU(t *testing.T) {
	c := NewLRU(2)
	c.Put(1, 1)
	c.Put(2, 2)
	c.Get(1)
	c.Put(3, 3)
	if _, ok := c.Get(2); ok {
		t.Fatal("eviction")
	}
	c.Put(1, 10)
	c.Put(4, 4)
	if _, ok := c.Get(3); ok {
		t.Fatal("order")
	}
	if v, ok := c.Get(1); !ok || v != 10 {
		t.Fatal(v)
	}
	z := NewLRU(0)
	z.Put(1, 1)
	if _, ok := z.Get(1); ok {
		t.Fatal("zero")
	}
}
func TestLRUConcurrent(t *testing.T) {
	c := NewLRU(8)
	var wg sync.WaitGroup
	for n := 0; n < 4; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				c.Put(i+n, i)
				c.Get(i)
			}
		}(n)
	}
	wg.Wait()
}
func TestTree(t *testing.T) {
	for _, s := range []string{"#", "1,#,#", "-1,2,#,#,3,#,#"} {
		n, e := Deserialize(s)
		if e != nil || Serialize(n) != s {
			t.Fatal(s, e)
		}
	}
	for _, s := range []string{"", "1,#", "1,#,#,2", "x,#,#", "#,1"} {
		if _, e := Deserialize(s); e == nil {
			t.Fatal("accepted", s)
		}
	}
}
func of(xs ...int) *ListNode {
	var h *ListNode
	for i := len(xs) - 1; i >= 0; i-- {
		h = &ListNode{xs[i], h}
	}
	return h
}
func vals(h *ListNode) []int {
	var r []int
	for h != nil {
		r = append(r, h.Val)
		h = h.Next
	}
	return r
}
func TestRemoveNth(t *testing.T) {
	for _, c := range []struct {
		in   []int
		k    int
		want []int
	}{{[]int{1}, 1, nil}, {[]int{1, 2, 3}, 3, []int{2, 3}}, {[]int{1, 2, 3}, 1, []int{1, 2}}, {[]int{1, 2, 3, 4, 5}, 2, []int{1, 2, 3, 5}}} {
		h, e := RemoveNthFromEnd(of(c.in...), c.k)
		if e != nil || !reflect.DeepEqual(vals(h), c.want) {
			t.Fatal(c, e)
		}
	}
	for _, k := range []int{0, -1, 4} {
		h, e := RemoveNthFromEnd(of(1, 2, 3), k)
		if e == nil || !reflect.DeepEqual(vals(h), []int{1, 2, 3}) {
			t.Fatal(k)
		}
	}
	if _, e := RemoveNthFromEnd(nil, 1); e == nil {
		t.Fatal("nil")
	}
}
func TestUnique(t *testing.T) {
	for s, w := range map[string]string{"bcabc": "abc", "cbacdcbc": "acdb", "bbcaac": "bac", "": "", "aaaa": "a"} {
		v, e := SmallestUniqueLetters(s)
		if e != nil || v != w {
			t.Fatal(s, v, w, e)
		}
	}
	if _, e := SmallestUniqueLetters("中文"); e == nil {
		t.Fatal("charset")
	}
}

// 枚举所有子序列的独立 oracle，避免测试直接照抄单调栈。
func oracle(s string) string {
	need := map[byte]bool{}
	for i := range s {
		need[s[i]] = true
	}
	best := ""
	for mask := 0; mask < (1 << len(s)); mask++ {
		v := []byte{}
		seen := map[byte]bool{}
		ok := true
		for i := range s {
			if mask&(1<<i) != 0 {
				if seen[s[i]] {
					ok = false
					break
				}
				seen[s[i]] = true
				v = append(v, s[i])
			}
		}
		if ok && len(seen) == len(need) {
			x := string(v)
			if best == "" || x < best {
				best = x
			}
		}
	}
	return best
}
func TestUniqueExhaustive(t *testing.T) {
	var walk func(string, int)
	walk = func(s string, left int) {
		v, e := SmallestUniqueLetters(s)
		if e != nil || v != oracle(s) {
			t.Fatal(s, v, oracle(s), e)
		}
		if left == 0 {
			return
		}
		for _, c := range []byte("abc") {
			walk(s+string(c), left-1)
		}
	}
	walk("", 6)
}
func TestAlternateExactAndExit(t *testing.T) {
	const want = "12AB34CD56EF78GH910IJ1112KL1314MN1516OP1718QR1920ST2122UV2324WX2526YZ2728"
	for i := 0; i < 50; i++ {
		done := make(chan string, 1)
		go func() { done <- AlternateNumbersLetters() }()
		select {
		case got := <-done:
			if got != want {
				t.Fatal(got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("did not finish")
		}
	}
}
